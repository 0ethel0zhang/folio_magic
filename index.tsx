import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Upload, Download, RefreshCw, Trash2, CheckCircle, Loader2, X, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import JSZip from 'jszip';

interface PortfolioFrame {
  id: string;
  url: string;
  blob: Blob;
  selected: boolean;
  timestamp: number;
}

const App = () => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [frames, setFrames] = useState<PortfolioFrame[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [expandedFrame, setExpandedFrame] = useState<PortfolioFrame | null>(null);

  // Keep track of frames for safe unmount cleanup without triggering re-renders
  const framesRef = useRef(frames);
  useEffect(() => {
      framesRef.current = frames;
  }, [frames]);

  // --- Video Processing Engine ---
  const processVideo = async (file: File) => {
    setIsProcessing(true);
    setProgress(0);
    setFrames([]);

    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    // Wait for metadata to load
    try {
        await new Promise((resolve, reject) => {
        video.onloadedmetadata = () => resolve(null);
        video.onerror = (e) => reject(e);
        // Timeout just in case
        setTimeout(() => reject(new Error("Video load timeout")), 10000);
        });
    } catch (e) {
        alert("Could not load video metadata. The file might be corrupt or unsupported.");
        setIsProcessing(false);
        return;
    }

    // Ensure sensible duration. Fallback to 1s if 0/NaN, cap if Infinity (streaming).
    let duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
        duration = 1;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;

    // Target roughly 30 frames for a good portfolio selection without crashing memory
    const targetFrameCount = 30;
    // Allow tighter spacing for short videos (down to 0.1s), ensuring we get enough frames
    // but don't over-process very long videos.
    const interval = Math.max(0.1, duration / targetFrameCount);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (!ctx) {
      setIsProcessing(false);
      alert("Could not initialize canvas for frame extraction.");
      return;
    }

    const newFrames: PortfolioFrame[] = [];
    // Start slightly in to avoid potential black frames at specifically 0.0s
    let currentTime = Math.min(0.1, duration / 10);
    
    // Safeguard: hard limit on iterations to prevent any possibility of infinite loops
    let loopCount = 0;
    const MAX_LOOPS = 60; 

    try {
      while (currentTime < duration && loopCount < MAX_LOOPS) {
        loopCount++;
        
        // Update progress based on time or hit count
        const timeProgress = (currentTime / duration) * 100;
        const loopProgress = (loopCount / MAX_LOOPS) * 100;
        setProgress(Math.min(99, Math.round(Math.max(timeProgress, loopProgress))));

        video.currentTime = currentTime;

        // Wait for seek to complete and frame to be ready, with a timeout safeguard
        try {
            await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    console.warn(`Frame seek timed out at ${currentTime}s, skipping.`);
                    resolve(null); 
                }, 2000); // 2 second max wait per frame

                video.onseeked = () => {
                    clearTimeout(timeoutId);
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => resolve(null));
                    });
                };
                
                video.onerror = (e) => {
                     clearTimeout(timeoutId);
                     reject(e);
                }
            });
        } catch (e) {
            console.error("Error seeking frame:", e);
        }

        // Draw frame to canvas
        ctx.drawImage(video, 0, 0, width, height);

        // Convert to blob
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));

        if (blob) {
          const url = URL.createObjectURL(blob);
          newFrames.push({
            id: `frame-${currentTime.toFixed(2)}`,
            url,
            blob,
            selected: true,
            timestamp: currentTime
          });
        }

        currentTime += interval;
      }
    } catch (error) {
      console.error("Error extracting frames:", error);
      alert("An error occurred while processing the video. Some frames might be missing.");
    } finally {
      // Cleanup
      URL.revokeObjectURL(video.src);
      video.remove();
      canvas.remove();

      setFrames(newFrames);
      setIsProcessing(false);
      setProgress(100);
    }
  };

  // --- Event Handlers ---
  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
      setVideoFile(file);
      processVideo(file);
    } else {
      alert('Please upload a valid video file.');
    }
  }, []);

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setVideoFile(file);
      processVideo(file);
    }
  };

  const handleRerun = useCallback(() => {
    // Cleanup all object URLs
    framesRef.current.forEach(f => URL.revokeObjectURL(f.url));
    setFrames([]);
    setVideoFile(null);
    setProgress(0);
    setIsProcessing(false);
  }, []);

  const toggleFrameSelection = (id: string) => {
    setFrames(frames => frames.map(f => f.id === id ? { ...f, selected: !f.selected } : f));
    // Also update expanded frame if it's the one being toggled
    if (expandedFrame && expandedFrame.id === id) {
        setExpandedFrame(prev => prev ? { ...prev, selected: !prev.selected } : null);
    }
  };

  const deleteFrame = (id: string) => {
    const frameIndex = frames.findIndex(f => f.id === id);
    // Prefer next frame, otherwise previous frame
    const nextFrameToShow = frames[frameIndex + 1] || frames[frameIndex - 1] || null;

    const newFrames = frames.filter(f => f.id !== id);

    // Revoke object URL to free memory
    const frameToDelete = frames.find(f => f.id === id);
    if (frameToDelete) URL.revokeObjectURL(frameToDelete.url);

    if (newFrames.length === 0) {
        // If no frames left, exit expanded mode and prompt user
        setExpandedFrame(null);
        setFrames([]); // Visually clear immediately
        
        // Use setTimeout to allow UI to settle before blocking alert
        setTimeout(() => {
            window.alert("Doesn't seem like this video has good photos. Want to try a different video?");
            handleRerun();
        }, 100);
    } else {
        setFrames(newFrames);
        // If currently expanded frame was deleted, move to next/prev
        if (expandedFrame && expandedFrame.id === id) {
            setExpandedFrame(nextFrameToShow);
        }
    }
  };

  const selectAll = (select: boolean) => {
    setFrames(frames.map(f => ({ ...f, selected: select })));
  };

  const handleDownload = async () => {
    const selectedFrames = frames.filter(f => f.selected);
    if (selectedFrames.length === 0) {
      alert("No frames selected for download.");
      return;
    }

    setIsZipping(true);

    try {
        const zip = new JSZip();
        
        selectedFrames.forEach((frame, i) => {
            // Pad index for nice sorting: portfolio_shot_01.jpg
            const indexStr = (i + 1).toString().padStart(2, '0');
            zip.file(`portfolio_shot_${indexStr}.jpg`, frame.blob);
        });

        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = "portfolio_stills.zip";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    } catch (error) {
        console.error("Error creating zip:", error);
        alert("Could not create zip file for download.");
    } finally {
        setIsZipping(false);
    }
  };

  // Cleanup ONLY on true component unmount, not on every frames state change
  useEffect(() => {
    return () => {
      framesRef.current.forEach(f => URL.revokeObjectURL(f.url));
    };
  }, []);

  // Navigation logic
  const currentIndex = expandedFrame ? frames.findIndex(f => f.id === expandedFrame.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex !== -1 && currentIndex < frames.length - 1;

  const goToPrev = useCallback(() => {
      if (hasPrev) setExpandedFrame(frames[currentIndex - 1]);
  }, [hasPrev, currentIndex, frames]);

  const goToNext = useCallback(() => {
      if (hasNext) setExpandedFrame(frames[currentIndex + 1]);
  }, [hasNext, currentIndex, frames]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!expandedFrame) return;
      
      switch (e.key) {
          case 'Escape':
              setExpandedFrame(null);
              break;
          case 'ArrowLeft':
              goToPrev();
              break;
          case 'ArrowRight':
              goToNext();
              break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expandedFrame, goToPrev, goToNext]);

  const selectedCount = frames.filter(f => f.selected).length;

  // --- Renderers ---

  if (!videoFile && !isProcessing && frames.length === 0) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-6 overflow-y-auto">
        <div className="max-w-2xl w-full text-center space-y-8 my-8">
          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-light tracking-tight text-neutral-100">Video to Portfolio</h1>
            <p className="text-neutral-400 text-lg">Extract high-fidelity stills from your videos for commercial use.</p>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            className={`
              relative border-2 border-dashed rounded-2xl p-12 md:p-16 transition-all duration-200 ease-out
              flex flex-col items-center justify-center space-y-4 cursor-pointer group
              ${isDragging ? 'border-blue-500 bg-blue-500/10 scale-[1.02]' : 'border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900/50'}
            `}
          >
            <div className="p-5 rounded-full bg-neutral-900 group-hover:bg-neutral-800 transition-colors">
              <Upload className="w-8 h-8 text-neutral-400 group-hover:text-neutral-200" />
            </div>
            <div className="space-y-2">
              <p className="text-xl font-medium text-neutral-200">Drag and drop your video here</p>
              <p className="text-neutral-500">or click to browse (MP4, MOV, WebM)</p>
            </div>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              id="file-upload"
              onChange={onFileSelect}
            />
            <label
              htmlFor="file-upload"
              className="absolute inset-0 cursor-pointer"
            >
              <span className="sr-only">Upload Video</span>
            </label>
          </div>
          
          {/* Contribution Section */}
          <div className="pt-6 flex flex-col items-center space-y-4">
            <p className="text-neutral-500 text-sm font-light max-w-md mx-auto text-center">
              Contribute to the development by {' '}
              <a
                href="https://docs.google.com/forms/d/e/1FAIpQLSeXTkgfM2dzjdU6CVtiQ6EReHgcmdK5KzmGmNZOuO_p50X_kg/viewform"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400/80 hover:text-blue-300 underline underline-offset-4 transition-colors"
                >
              giving feedback
              </a>
              {' '} :)
            </p>
          </div>

        </div>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-8">
          <div className="relative">
             <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto" />
          </div>
          <h2 className="text-2xl font-light text-neutral-200 animate-pulse">Analyzing Video & Extracting Stills</h2>
          <div className="space-y-3">
            <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-neutral-500 text-sm font-mono tracking-wider">{progress}% Complete</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col">
      {/* Fixed Header */}
      <header className="bg-neutral-900/80 backdrop-blur-md border-b border-neutral-800 sticky top-0 z-40 px-4 md:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
           <h1 className="text-lg md:text-xl font-medium tracking-tight text-neutral-100">Portfolio Curator</h1>
           <span className="text-neutral-700 hidden sm:block">|</span>
           <p className="text-neutral-400 text-sm md:text-base">{selectedCount} selected</p>
        </div>

        <div className="flex items-center space-x-2 md:space-x-3">
          <span className="text-sm font-mono text-neutral-400 bg-neutral-800/80 px-3 py-1.5 rounded-full hidden sm:block mr-2">
             {frames.length} left
          </span>
          <button
            onClick={() => selectAll(frames.some(f => !f.selected))}
            className="px-3 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors whitespace-nowrap"
            disabled={isZipping}
          >
            {frames.some(f => !f.selected) ? 'Select All' : 'Deselect All'}
          </button>
          <button
            onClick={handleRerun}
            className="p-2 md:px-4 md:py-2 rounded-lg text-sm font-medium text-neutral-300 hover:bg-neutral-800 transition-colors"
            title="Start Over"
            disabled={isZipping}
          >
            <RefreshCw className="w-5 h-5 sm:hidden" />
            <span className="hidden sm:inline">Start Over</span>
          </button>
          <button
            onClick={handleDownload}
            disabled={selectedCount === 0 || isZipping}
            className={`
              flex items-center space-x-2 px-4 md:px-6 py-2 rounded-lg text-sm font-medium transition-all
              ${selectedCount > 0 && !isZipping
                ? 'bg-white text-black hover:bg-neutral-200'
                : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'}
            `}
          >
            {isZipping ? (
                <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
                <Download className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">{isZipping ? 'Zipping...' : 'Download Selected'}</span>
            <span className="sm:hidden">{isZipping ? '...' : 'Download'}</span>
          </button>
        </div>
      </header>

      {/* Main Gallery */}
      <main className="flex-1 p-4 md:p-6 overflow-y-auto">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {frames.map((frame) => (
            <div
              key={frame.id}
              className={`
                relative group aspect-[3/4] rounded-lg overflow-hidden bg-neutral-900 cursor-pointer border transition-all duration-200
                ${frame.selected ? 'border-white/40 ring-1 ring-white/10' : 'border-transparent opacity-80 hover:opacity-100'}
              `}
              onClick={() => !isZipping && setExpandedFrame(frame)}
            >
              <img
                src={frame.url}
                alt={`Frame at ${frame.timestamp}s`}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                    // Visual indicator if frame breaks, though fix above should prevent this.
                    (e.target as HTMLImageElement).style.opacity = '0.3';
                }}
              />

              {/* Selection Indicator - Now a button to prevent bubble up */}
              <button
                className="absolute top-3 left-3 transition-transform duration-200 z-10 focus:outline-none"
                onClick={(e) => {
                    e.stopPropagation();
                    toggleFrameSelection(frame.id);
                }}
              >
                 {frame.selected ? (
                   <CheckCircle className="w-6 h-6 text-white fill-black/50 drop-shadow-lg" />
                 ) : (
                   <div className="w-5 h-5 rounded-full border-2 border-white/50 bg-black/20 backdrop-blur-sm hover:border-white transition-colors"></div>
                 )}
              </button>

               {/* Hover Overlay & Actions */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isZipping) deleteFrame(frame.id);
                }}
                className="absolute top-3 right-3 p-1.5 rounded-full bg-black/50 backdrop-blur-md text-white/70 hover:text-red-400 hover:bg-black/80 transition-all opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0"
                title="Delete frame"
                disabled={isZipping}
              >
                <Trash2 className="w-4 h-4" />
              </button>

              <div className="absolute bottom-3 left-3 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                  <span className="text-[10px] font-medium text-white/90 font-mono bg-black/50 backdrop-blur-md px-1.5 py-0.5 rounded">
                      {new Date(frame.timestamp * 1000).toISOString().substr(14, 5)}
                  </span>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Lightbox Modal */}
      {expandedFrame && (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setExpandedFrame(null)}
        >
             {/* Top Right Controls */}
             <div className="absolute top-4 right-4 flex items-center space-x-3 z-50" onClick={e => e.stopPropagation()}>
                 <span className="text-sm font-mono text-neutral-300 bg-black/50 px-3 py-1.5 rounded-full backdrop-blur-md">
                    {frames.length} left
                 </span>
                 <button
                    className="p-2 text-neutral-400 hover:text-red-400 bg-black/50 rounded-full backdrop-blur-md transition-colors"
                    onClick={() => deleteFrame(expandedFrame.id)}
                    title="Delete frame"
                 >
                     <Trash2 className="w-6 h-6" />
                 </button>
                 <button 
                    className="p-2 text-neutral-400 hover:text-white bg-black/50 rounded-full backdrop-blur-md transition-colors"
                    onClick={() => setExpandedFrame(null)}
                    title="Close"
                 >
                    <X className="w-6 h-6" />
                 </button>
             </div>

            {/* Top Bar Info */}
             <div className="absolute top-4 left-4 flex items-center space-x-4 z-50" onClick={e => e.stopPropagation()}>
                <span className="text-sm font-mono text-neutral-300 bg-black/50 px-3 py-1.5 rounded-full backdrop-blur-md">
                    {new Date(expandedFrame.timestamp * 1000).toISOString().substr(14, 5)}
                </span>
                <button
                    onClick={() => toggleFrameSelection(expandedFrame.id)}
                    className={`
                        flex items-center space-x-2 px-3 py-1.5 rounded-full text-sm font-medium backdrop-blur-md transition-colors
                        ${expandedFrame.selected 
                            ? 'bg-white text-black hover:bg-neutral-200' 
                            : 'bg-black/50 text-white border border-white/20 hover:bg-black/70'}
                    `}
                >
                    {expandedFrame.selected ? <CheckCircle className="w-4 h-4 fill-black/10" /> : <div className="w-4 h-4 rounded-full border-2 border-current" />}
                    <span>{expandedFrame.selected ? 'Selected' : 'Select'}</span>
                </button>
             </div>

            {/* Navigation Arrows */}
            {hasPrev && (
                <button
                    className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-neutral-400 hover:text-white bg-black/30 hover:bg-black/60 rounded-full backdrop-blur-md transition-all z-50"
                    onClick={(e) => { e.stopPropagation(); goToPrev(); }}
                    title="Previous frame (Left Arrow)"
                >
                    <ChevronLeft className="w-8 h-8" />
                </button>
            )}
            {hasNext && (
                <button
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-neutral-400 hover:text-white bg-black/30 hover:bg-black/60 rounded-full backdrop-blur-md transition-all z-50"
                    onClick={(e) => { e.stopPropagation(); goToNext(); }}
                    title="Next frame (Right Arrow)"
                >
                    <ChevronRight className="w-8 h-8" />
                </button>
            )}

            {/* Image Container */}
            <div className="w-full h-full p-4 md:p-12 flex items-center justify-center pointer-events-none">
                 <img
                    src={expandedFrame.url}
                    alt="Expanded frame"
                    className="max-w-full max-h-full object-contain shadow-2xl pointer-events-auto"
                    onClick={e => e.stopPropagation()}
                    onError={(e) => {
                        (e.target as HTMLImageElement).style.opacity = '0.5';
                    }}
                />
            </div>
        </div>
      )}

      {/* Contribution Section */}
      <div className="pt-6 flex flex-col items-center space-y-4">
        <p className="text-neutral-500 text-sm font-light max-w-md mx-auto text-center">
          Contribute to the development by {' '}
          <a
            href="https://docs.google.com/forms/d/e/1FAIpQLSeXTkgfM2dzjdU6CVtiQ6EReHgcmdK5KzmGmNZOuO_p50X_kg/viewform"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400/80 hover:text-blue-300 underline underline-offset-4 transition-colors"
          >
            giving feedback
          </a>
          {' '}or sending me a Venmo gift :)
        </p>
        <div className="w-[30%] min-w-[120px] max-w-[200px] hover:opacity-100 opacity-90 transition-opacity">
          <img
            src="https://github.com/0ethel0zhang/folio_magic/blob/main/venmo_qr.png?raw=true"
            alt="Venmo QR Code"
            className="w-full h-auto rounded-xl border border-neutral-800/50"
          />
        </div>
        <p className="text-neutral-500 text-xs font-bold">
          Developed by BringEZBack @ 2025.
        </p>
      </div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
} else {
  document.body.innerHTML = '<div class="text-red-500 p-4">Error: #root element not found in HTML.</div>';
}

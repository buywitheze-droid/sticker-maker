import ContourWorker from './contour-worker?worker';
import { calculateEffectiveDesignSize } from './types';

export interface ContourData {
  pathPoints: Array<{x: number; y: number}>;
  widthInches: number;
  heightInches: number;
  imageOffsetX: number;
  imageOffsetY: number;
  backgroundColor: string;
  useEdgeBleed: boolean;
}

interface WorkerResponse {
  type: 'result' | 'error' | 'progress';
  imageData?: ImageData;
  error?: string;
  progress?: number;
  contourData?: ContourData;
}

interface WorkerResult {
  imageData: ImageData;
  contourData?: ContourData;
}

interface ResizeSettings {
  widthInches: number;
  heightInches: number;
  maintainAspectRatio: boolean;
  outputDPI: number;
}

interface ProcessRequest {
  imageData: ImageData;
  strokeSettings: {
    width: number;
    color: string;
    enabled: boolean;
    alphaThreshold: number;
    closeSmallGaps: boolean;
    closeBigGaps: boolean;
    backgroundColor: string;
    useCustomBackground: boolean;
  };
  effectiveDPI: number;
  resizeSettings: ResizeSettings;
  previewMode?: boolean;
}

type ProgressCallback = (progress: number) => void;

class ContourWorkerManager {
  private worker: Worker | null = null;
  private isProcessing = false;
  private pendingRequest: {
    request: ProcessRequest;
    resolve: (result: WorkerResult) => void;
    reject: (error: Error) => void;
    onProgress?: ProgressCallback;
  } | null = null;
  private currentRequest: {
    resolve: (result: WorkerResult) => void;
    reject: (error: Error) => void;
    onProgress?: ProgressCallback;
  } | null = null;
  
  // Cache the contour data from the last successful process for fast PDF export
  private cachedContourData: ContourData | null = null;

  constructor() {
    this.initWorker();
  }
  
  // Get cached contour data for PDF export
  getCachedContourData(): ContourData | null {
    return this.cachedContourData;
  }
  
  // Clear cached data when settings change
  clearCache() {
    console.log('[ContourWorkerManager] clearCache called, had data:', !!this.cachedContourData);
    this.cachedContourData = null;
  }

  private initWorker() {
    try {
      this.worker = new ContourWorker();
      this.worker.onmessage = this.handleMessage.bind(this);
      this.worker.onerror = this.handleError.bind(this);
    } catch (error) {
      console.warn('Web Worker not available, falling back to main thread');
      this.worker = null;
    }
  }

  private handleMessage(e: MessageEvent<WorkerResponse>) {
    const { type, imageData, error, progress, contourData } = e.data;

    if (type === 'progress' && this.currentRequest?.onProgress && progress !== undefined) {
      this.currentRequest.onProgress(progress);
      return;
    }

    if (type === 'result' && imageData && this.currentRequest) {
      // Cache the contour data for fast PDF export
      if (contourData) {
        this.cachedContourData = contourData;
      }
      this.currentRequest.resolve({ imageData, contourData });
      this.finishProcessing();
    } else if (type === 'error' && this.currentRequest) {
      this.currentRequest.reject(new Error(error || 'Unknown worker error'));
      this.finishProcessing();
    }
  }

  private handleError(error: ErrorEvent) {
    console.error('Worker error:', error);
    if (this.currentRequest) {
      this.currentRequest.reject(new Error('Worker crashed'));
      this.finishProcessing();
    }
    this.initWorker();
  }

  private finishProcessing() {
    this.currentRequest = null;
    this.isProcessing = false;

    if (this.pendingRequest) {
      const { request, resolve, reject, onProgress } = this.pendingRequest;
      this.pendingRequest = null;
      this.processInWorker(request, onProgress).then(resolve).catch(reject);
    }
  }

  async process(
    image: HTMLImageElement,
    strokeSettings: {
      width: number;
      color: string;
      enabled: boolean;
      alphaThreshold: number;
      closeSmallGaps: boolean;
      closeBigGaps: boolean;
      backgroundColor: string;
      useCustomBackground: boolean;
    },
    resizeSettings: ResizeSettings,
    onProgress?: ProgressCallback
  ): Promise<HTMLCanvasElement> {
    if (!this.worker) {
      return this.processFallback(image, strokeSettings, resizeSettings);
    }

    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    
    const clonedData = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );

    // Use the shared helper for calculating effective design size
    // The selected size is the TOTAL sticker size (design + contour)
    const { widthInches: effectiveDesignWidth, heightInches: effectiveDesignHeight } = 
      calculateEffectiveDesignSize(
        resizeSettings.widthInches,
        resizeSettings.heightInches,
        strokeSettings.width,
        true // contour is enabled
      );
    
    // DPI is calculated from the effective design size (smaller)
    // This ensures the contour offset brings the total back to the selected size
    const dpiFromWidth = image.width / effectiveDesignWidth;
    const dpiFromHeight = image.height / effectiveDesignHeight;
    const effectiveDPI = Math.min(dpiFromWidth, dpiFromHeight);
    
    const request: ProcessRequest = {
      imageData: clonedData,
      strokeSettings,
      effectiveDPI: effectiveDPI,
      resizeSettings: { ...resizeSettings, outputDPI: effectiveDPI },
      previewMode: true
    };

    const result = await this.processInWorker(request, onProgress);

    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = result.imageData.width;
    resultCanvas.height = result.imageData.height;
    const resultCtx = resultCanvas.getContext('2d');
    if (!resultCtx) throw new Error('Could not get result canvas context');

    resultCtx.putImageData(result.imageData, 0, 0);
    return resultCanvas;
  }

  private processInWorker(request: ProcessRequest, onProgress?: ProgressCallback): Promise<WorkerResult> {
    return new Promise((resolve, reject) => {
      if (this.isProcessing) {
        this.pendingRequest = { request, resolve, reject, onProgress };
        return;
      }

      this.isProcessing = true;
      this.currentRequest = { resolve, reject, onProgress };

      this.worker!.postMessage({
        type: 'process',
        imageData: request.imageData,
        strokeSettings: request.strokeSettings,
        effectiveDPI: request.effectiveDPI,
        previewMode: request.previewMode ?? true
      }, [request.imageData.data.buffer]);
    });
  }

  private async processFallback(
    image: HTMLImageElement,
    strokeSettings: {
      width: number;
      color: string;
      enabled: boolean;
      alphaThreshold: number;
      closeSmallGaps: boolean;
      closeBigGaps: boolean;
      backgroundColor: string;
      useCustomBackground: boolean;
    },
    resizeSettings: ResizeSettings
  ): Promise<HTMLCanvasElement> {
    const { createSilhouetteContour } = await import('./contour-outline');
    return createSilhouetteContour(image, strokeSettings, resizeSettings);
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

let managerInstance: ContourWorkerManager | null = null;

export function getContourWorkerManager(): ContourWorkerManager {
  if (!managerInstance) {
    managerInstance = new ContourWorkerManager();
  }
  return managerInstance;
}

export async function processContourInWorker(
  image: HTMLImageElement,
  strokeSettings: {
    width: number;
    color: string;
    enabled: boolean;
    alphaThreshold: number;
    closeSmallGaps: boolean;
    closeBigGaps: boolean;
    backgroundColor: string;
    useCustomBackground: boolean;
  },
  resizeSettings: ResizeSettings,
  onProgress?: ProgressCallback
): Promise<HTMLCanvasElement> {
  const manager = getContourWorkerManager();
  return manager.process(image, strokeSettings, resizeSettings, onProgress);
}

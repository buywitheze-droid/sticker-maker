import ContourWorker from './contour-worker?worker';

interface WorkerResponse {
  type: 'result' | 'error' | 'progress';
  imageData?: ImageData;
  error?: string;
  progress?: number;
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
  };
  effectiveDPI: number;
  resizeSettings: ResizeSettings;
}

type ProgressCallback = (progress: number) => void;

class ContourWorkerManager {
  private worker: Worker | null = null;
  private isProcessing = false;
  private pendingRequest: {
    request: ProcessRequest;
    resolve: (result: ImageData) => void;
    reject: (error: Error) => void;
    onProgress?: ProgressCallback;
  } | null = null;
  private currentRequest: {
    resolve: (result: ImageData) => void;
    reject: (error: Error) => void;
    onProgress?: ProgressCallback;
  } | null = null;

  constructor() {
    this.initWorker();
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
    const { type, imageData, error, progress } = e.data;

    if (type === 'progress' && this.currentRequest?.onProgress && progress !== undefined) {
      this.currentRequest.onProgress(progress);
      return;
    }

    if (type === 'result' && imageData && this.currentRequest) {
      this.currentRequest.resolve(imageData);
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

    const request: ProcessRequest = {
      imageData: clonedData,
      strokeSettings,
      effectiveDPI: resizeSettings.outputDPI,
      resizeSettings
    };

    const resultData = await this.processInWorker(request, onProgress);

    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = resultData.width;
    resultCanvas.height = resultData.height;
    const resultCtx = resultCanvas.getContext('2d');
    if (!resultCtx) throw new Error('Could not get result canvas context');

    resultCtx.putImageData(resultData, 0, 0);
    return resultCanvas;
  }

  private processInWorker(request: ProcessRequest, onProgress?: ProgressCallback): Promise<ImageData> {
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
        effectiveDPI: request.effectiveDPI
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
  },
  resizeSettings: ResizeSettings,
  onProgress?: ProgressCallback
): Promise<HTMLCanvasElement> {
  const manager = getContourWorkerManager();
  return manager.process(image, strokeSettings, resizeSettings, onProgress);
}

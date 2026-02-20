import ContourWorker from './contour-worker?worker';

const MAX_PROCESSING_DIMENSION = 4000;

function downsampleImage(image: HTMLImageElement): { canvas: HTMLCanvasElement; scale: number } {
  const maxDim = Math.max(image.width, image.height);
  
  if (maxDim <= MAX_PROCESSING_DIMENSION) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return { canvas, scale: 1 };
  }
  
  const scale = MAX_PROCESSING_DIMENSION / maxDim;
  const newWidth = Math.round(image.width * scale);
  const newHeight = Math.round(image.height * scale);
  
  console.log(`[ContourWorker] Downsampling from ${image.width}x${image.height} to ${newWidth}x${newHeight} (scale: ${scale.toFixed(3)})`);
  
  const canvas = document.createElement('canvas');
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext('2d')!;
  
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, newWidth, newHeight);
  
  return { canvas, scale };
}

export type DetectedAlgorithm = 'shapes' | 'complex' | 'scattered';

export interface ContourData {
  pathPoints: Array<{x: number; y: number}>;
  previewPathPoints: Array<{x: number; y: number}>;
  widthInches: number;
  heightInches: number;
  imageOffsetX: number;
  imageOffsetY: number;
  backgroundColor: string;
  useEdgeBleed: boolean;
  effectiveDPI: number;
  minPathX: number;
  minPathY: number;
  bleedInches: number;
  psaShapeType?: string;
}

interface WorkerResponse {
  type: 'result' | 'error' | 'progress';
  imageData?: ImageData;
  imageCanvasX?: number;
  imageCanvasY?: number;
  error?: string;
  progress?: number;
  contourData?: ContourData;
  detectedAlgorithm?: DetectedAlgorithm;
}

interface WorkerResult {
  imageData: ImageData;
  imageCanvasX?: number;
  imageCanvasY?: number;
  contourData?: ContourData;
  detectedAlgorithm?: DetectedAlgorithm;
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
    backgroundColor: string;
    useCustomBackground: boolean;
    autoBridging: boolean;
    autoBridgingThreshold: number;
    cornerMode: 'rounded' | 'sharp';
    algorithm?: 'shapes' | 'complex';
    psa?: { enabled: boolean; confidenceThreshold: number; mergeDistInches: number; bridgeRadiusInches: number; minShapeAreaIn2: number };
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
  
  private cachedContourData: ContourData | null = null;

  constructor() {
    this.initWorker();
  }
  
  getCachedContourData(): ContourData | null {
    return this.cachedContourData;
  }
  
  clearCache() {
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
    const { type, imageData, imageCanvasX, imageCanvasY, error, progress, contourData, detectedAlgorithm } = e.data;

    if (type === 'progress' && this.currentRequest?.onProgress && progress !== undefined) {
      this.currentRequest.onProgress(progress);
      return;
    }

    if (type === 'result' && imageData && this.currentRequest) {
      if (contourData) {
        this.cachedContourData = contourData;
      }
      this.currentRequest.resolve({ imageData, imageCanvasX, imageCanvasY, contourData, detectedAlgorithm });
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
      backgroundColor: string;
      useCustomBackground: boolean;
      autoBridging: boolean;
      autoBridgingThreshold: number;
      cornerMode: 'rounded' | 'sharp';
      algorithm?: 'shapes' | 'complex';
      psa?: { enabled: boolean; confidenceThreshold: number; mergeDistInches: number; bridgeRadiusInches: number; minShapeAreaIn2: number };
    },
    resizeSettings: ResizeSettings,
    onProgress?: ProgressCallback
  ): Promise<{ canvas: HTMLCanvasElement; downsampleScale: number; imageCanvasX: number; imageCanvasY: number; contourData?: ContourData; detectedAlgorithm?: DetectedAlgorithm }> {
    if (!this.worker) {
      const canvas = await this.processFallback(image, strokeSettings, resizeSettings);
      return { canvas, downsampleScale: 1, imageCanvasX: 0, imageCanvasY: 0 };
    }

    const { canvas, scale } = downsampleImage(image);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    const clonedData = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );

    const dpiFromWidth = canvas.width / resizeSettings.widthInches;
    const dpiFromHeight = canvas.height / resizeSettings.heightInches;
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

    return {
      canvas: resultCanvas,
      downsampleScale: scale,
      imageCanvasX: result.imageCanvasX ?? 0,
      imageCanvasY: result.imageCanvasY ?? 0,
      contourData: result.contourData,
      detectedAlgorithm: result.detectedAlgorithm
    };
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
      backgroundColor: string;
      useCustomBackground: boolean;
      autoBridging: boolean;
      autoBridgingThreshold: number;
      cornerMode: 'rounded' | 'sharp';
      algorithm?: 'shapes' | 'complex';
      psa?: { enabled: boolean; confidenceThreshold: number; mergeDistInches: number; bridgeRadiusInches: number; minShapeAreaIn2: number };
    },
    resizeSettings: ResizeSettings
  ): Promise<HTMLCanvasElement> {
    let processImage = image;
    const maxDim = Math.max(image.width, image.height);
    
    if (maxDim > MAX_PROCESSING_DIMENSION) {
      const scale = MAX_PROCESSING_DIMENSION / maxDim;
      const newWidth = Math.round(image.width * scale);
      const newHeight = Math.round(image.height * scale);
      
      console.log(`[ContourFallback] Downsampling from ${image.width}x${image.height} to ${newWidth}x${newHeight}`);
      
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = newWidth;
      tempCanvas.height = newHeight;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingQuality = 'high';
      tempCtx.drawImage(image, 0, 0, newWidth, newHeight);
      
      processImage = await new Promise<HTMLImageElement>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = tempCanvas.toDataURL('image/png');
      });
    }
    
    const { createSilhouetteContour } = await import('./contour-outline');
    return createSilhouetteContour(processImage, strokeSettings, resizeSettings);
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
    backgroundColor: string;
    useCustomBackground: boolean;
    autoBridging: boolean;
    autoBridgingThreshold: number;
    cornerMode: 'rounded' | 'sharp';
    algorithm?: 'shapes' | 'complex';
    psa?: { enabled: boolean; confidenceThreshold: number; mergeDistInches: number; bridgeRadiusInches: number; minShapeAreaIn2: number };
  },
  resizeSettings: ResizeSettings,
  onProgress?: ProgressCallback
): Promise<{ canvas: HTMLCanvasElement; downsampleScale: number; imageCanvasX: number; imageCanvasY: number; contourData?: ContourData; detectedAlgorithm?: DetectedAlgorithm }> {
  const manager = getContourWorkerManager();
  return manager.process(image, strokeSettings, resizeSettings, onProgress);
}

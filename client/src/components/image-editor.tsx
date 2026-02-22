import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import UploadSection from "./upload-section";
import PreviewSection from "./preview-section";
import ControlsSection, { SpotPreviewData } from "./controls-section";
import { calculateImageDimensions, downloadCanvas } from "@/lib/image-utils";
import { cropImageToContent } from "@/lib/image-crop";
import { createVectorStroke, downloadVectorStroke, createVectorPaths, type VectorFormat } from "@/lib/vector-stroke";
import { createTrueContour } from "@/lib/true-contour";
import { createCTContour } from "@/lib/ctcontour";
import { checkCadCutBounds, type CadCutBounds } from "@/lib/cadcut-bounds";
import { downloadZipPackage } from "@/lib/zip-download";
import { downloadContourPDF, type CachedContourData, type SpotColorInput } from "@/lib/contour-outline";
import { getContourWorkerManager, type DetectedAlgorithm, type DetectedShapeInfo } from "@/lib/contour-worker-manager";
import { downloadShapePDF, calculateShapeDimensions, generateShapePathPointsInches } from "@/lib/shape-outline";
import { useDebouncedValue } from "@/hooks/use-debounce";
import { removeBackgroundFromImage } from "@/lib/background-removal";
import type { ParsedPDFData } from "@/lib/pdf-parser";
import { detectShape, mapDetectedShapeToType } from "@/lib/shape-detection";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Copy, ChevronDown, ChevronUp, Info } from "lucide-react";

export type { ImageInfo, StrokeSettings, StrokeMode, ResizeSettings, ShapeSettings, StickerSize, LockedContour, ImageTransform, DesignItem } from "@/lib/types";
import type { ImageInfo, StrokeSettings, StrokeMode, ResizeSettings, ShapeSettings, StickerSize, LockedContour, ImageTransform, DesignItem } from "@/lib/types";

export default function ImageEditor({ onDesignUploaded }: { onDesignUploaded?: () => void } = {}) {
  const { toast } = useToast();
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [cadCutBounds, setCadCutBounds] = useState<CadCutBounds | null>(null);
  const [strokeSettings, setStrokeSettings] = useState<StrokeSettings>({
    width: 0.14, // Default large offset
    color: "#ffffff",
    enabled: false,
    alphaThreshold: 128, // Auto-detected from alpha channel
    backgroundColor: "#ffffff", // Default white background for contour
    useCustomBackground: true, // Default to solid background color
    cornerMode: 'rounded',
    autoBridging: true, // Auto-bridge narrow gaps in contour
    autoBridgingThreshold: 0.02, // Gap threshold in inches
    contourMode: undefined,
  });
  const [resizeSettings, setResizeSettings] = useState<ResizeSettings>({
    widthInches: 5.0,
    heightInches: 3.8,
    maintainAspectRatio: true,
    outputDPI: 300,
  });
  const [shapeSettings, setShapeSettings] = useState<ShapeSettings>({
    enabled: false,
    type: 'square',
    offset: 0.25, // Default "Big" offset around design
    fillColor: '#FFFFFF',
    strokeEnabled: false,
    strokeWidth: 2,
    strokeColor: '#000000',
    cornerRadius: 0.25, // Default corner radius for rounded shapes (in inches)
    bleedEnabled: false, // Color bleed outside the shape
    bleedColor: '#FFFFFF', // Default bleed color
  });
  const [strokeMode, setStrokeMode] = useState<StrokeMode>('none');
  const [stickerSize, setStickerSize] = useState<StickerSize>(4); // Default 4 inch max dimension
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRemovingBackground, setIsRemovingBackground] = useState(false);
  const [spotPreviewData, setSpotPreviewData] = useState<SpotPreviewData>({ enabled: false, colors: [] });
  const [detectedAlgorithm, setDetectedAlgorithm] = useState<DetectedAlgorithm | undefined>(undefined);
  const [detectedShapeType, setDetectedShapeType] = useState<'circle' | 'oval' | 'square' | 'rectangle' | null>(null);
  const [detectedShapeInfo, setDetectedShapeInfo] = useState<DetectedShapeInfo | null>(null);
  const [cutContourLabel, setCutContourLabel] = useState<'CutContour' | 'PerfCutContour' | 'KissCut'>('CutContour');
  const [showCutLabelDropdown, setShowCutLabelDropdown] = useState(false);
  const cutLabelRef = useRef<HTMLDivElement>(null);
  const [lockedContour, setLockedContour] = useState<LockedContour | null>(null);
  const [artboardWidth, setArtboardWidth] = useState(24.5);
  const [artboardHeight, setArtboardHeight] = useState(12);
  const [designTransform, setDesignTransform] = useState<ImageTransform>({ nx: 0.5, ny: 0.5, s: 1, rotation: 0 });
  const [showApplyAddDropdown, setShowApplyAddDropdown] = useState(false);
  const applyAddRef = useRef<HTMLDivElement>(null);
  const [designs, setDesigns] = useState<DesignItem[]>([]);
  const [selectedDesignId, setSelectedDesignId] = useState<string | null>(null);
  const [showDesignInfo, setShowDesignInfo] = useState(false);
  const designInfoRef = useRef<HTMLDivElement>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Debounced settings for heavy processing
  const debouncedStrokeSettings = useDebouncedValue(strokeSettings, 100);
  const debouncedResizeSettings = useDebouncedValue(resizeSettings, 250);
  const debouncedShapeSettings = useDebouncedValue(shapeSettings, 100);

  // Function to update CadCut bounds checking - accepts shape settings to avoid stale closure
  const updateCadCutBounds = useCallback((
    shapeWidthInches: number, 
    shapeHeightInches: number,
    currentShapeSettings: ShapeSettings
  ) => {
    if (!imageInfo) {
      setCadCutBounds(null);
      return;
    }

    // Convert inches to pixels for bounds checking
    const shapeWidthPixels = shapeWidthInches * imageInfo.dpi;
    const shapeHeightPixels = shapeHeightInches * imageInfo.dpi;

    const bounds = checkCadCutBounds(
      imageInfo.image,
      currentShapeSettings,
      shapeWidthPixels,
      shapeHeightPixels
    );

    setCadCutBounds(bounds);
  }, [imageInfo]);

  const selectedDesign = useMemo(() => designs.find(d => d.id === selectedDesignId) || null, [designs, selectedDesignId]);
  const activeImageInfo = useMemo(() => selectedDesign?.imageInfo || imageInfo, [selectedDesign, imageInfo]);
  const activeDesignTransform = useMemo(() => selectedDesign?.transform || designTransform, [selectedDesign, designTransform]);
  const activeWidthInches = useMemo(() => selectedDesign?.widthInches || resizeSettings.widthInches, [selectedDesign, resizeSettings.widthInches]);
  const activeHeightInches = useMemo(() => selectedDesign?.heightInches || resizeSettings.heightInches, [selectedDesign, resizeSettings.heightInches]);
  const activeResizeSettings = useMemo(() => ({
    ...resizeSettings,
    widthInches: activeWidthInches,
    heightInches: activeHeightInches,
  }), [resizeSettings, activeWidthInches, activeHeightInches]);

  useEffect(() => {
    if (activeImageInfo && onDesignUploaded) {
      onDesignUploaded();
    }
  }, [activeImageInfo, onDesignUploaded]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (cutLabelRef.current && !cutLabelRef.current.contains(e.target as Node)) {
        setShowCutLabelDropdown(false);
      }
      if (applyAddRef.current && !applyAddRef.current.contains(e.target as Node)) {
        setShowApplyAddDropdown(false);
      }
      if (designInfoRef.current && !designInfoRef.current.contains(e.target as Node)) {
        setShowDesignInfo(false);
      }
    };
    if (showCutLabelDropdown || showApplyAddDropdown || showDesignInfo) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showCutLabelDropdown, showApplyAddDropdown, showDesignInfo]);

  const handleSelectDesign = useCallback((id: string | null) => {
    setSelectedDesignId(id);
  }, []);

  const handleDesignTransformChange = useCallback((transform: ImageTransform) => {
    setDesignTransform(transform);
    if (selectedDesignId) {
      setDesigns(prev => prev.map(d => d.id === selectedDesignId ? { ...d, transform } : d));
    }
  }, [selectedDesignId]);

  const handleDuplicateDesign = useCallback(() => {
    if (!selectedDesignId) return;
    const design = designs.find(d => d.id === selectedDesignId);
    if (!design) return;
    const newId = crypto.randomUUID();
    const newDesign: DesignItem = {
      ...design,
      id: newId,
      name: design.name.replace(/( copy \d+)?$/, '') + ` copy ${designs.length}`,
      transform: { ...design.transform, nx: Math.min(design.transform.nx + 0.05, 0.95), ny: Math.min(design.transform.ny + 0.05, 0.95) },
    };
    setDesigns(prev => [...prev, newDesign]);
    setSelectedDesignId(newId);
  }, [selectedDesignId, designs]);

  const handleDeleteDesign = useCallback((id: string) => {
    setDesigns(prev => prev.filter(d => d.id !== id));
    if (selectedDesignId === id) {
      const remaining = designs.filter(d => d.id !== id);
      if (remaining.length > 0) {
        setSelectedDesignId(remaining[remaining.length - 1].id);
      } else {
        setSelectedDesignId(null);
        setImageInfo(null);
      }
    }
  }, [selectedDesignId, designs]);

  const handleApplyAndAdd = useCallback((newLabel: 'CutContour' | 'PerfCutContour' | 'KissCut') => {
    const workerManager = getContourWorkerManager();
    const contourData = workerManager.getCachedContourData();

    if (contourData && contourData.pathPoints && contourData.pathPoints.length >= 3) {
      const previewCanvas = canvasRef.current as any;
      const contourCanvasInfo = previewCanvas?.getContourCanvasInfo?.();
      const cw = contourCanvasInfo?.width ?? 1;
      const ch = contourCanvasInfo?.height ?? 1;
      const icx = contourCanvasInfo?.imageCanvasX ?? 0;
      const icy = contourCanvasInfo?.imageCanvasY ?? 0;
      const ds = contourCanvasInfo?.downsampleScale ?? 1;
      const currentImg = selectedDesign?.imageInfo || imageInfo;
      const icw = currentImg ? Math.round(currentImg.image.width * ds) : cw;
      const ich = currentImg ? Math.round(currentImg.image.height * ds) : ch;

      setLockedContour({
        label: cutContourLabel,
        pathPoints: [...contourData.pathPoints],
        previewPathPoints: [...contourData.previewPathPoints],
        widthInches: contourData.widthInches,
        heightInches: contourData.heightInches,
        imageOffsetX: contourData.imageOffsetX,
        imageOffsetY: contourData.imageOffsetY,
        backgroundColor: contourData.backgroundColor,
        effectiveDPI: contourData.effectiveDPI,
        minPathX: contourData.minPathX,
        minPathY: contourData.minPathY,
        bleedInches: contourData.bleedInches,
        contourCanvasWidth: cw,
        contourCanvasHeight: ch,
        imageCanvasX: icx,
        imageCanvasY: icy,
        imageCanvasWidth: icw,
        imageCanvasHeight: ich,
      });
    } else if (shapeSettings.enabled) {
      const shapeData = generateShapePathPointsInches(shapeSettings, resizeSettings);
      setLockedContour({
        label: cutContourLabel,
        pathPoints: shapeData.pathPoints,
        previewPathPoints: shapeData.pathPoints,
        widthInches: shapeData.widthInches,
        heightInches: shapeData.heightInches,
        imageOffsetX: shapeData.imageOffsetX,
        imageOffsetY: shapeData.imageOffsetY,
        backgroundColor: '#ffffff',
        effectiveDPI: 300,
        minPathX: 0,
        minPathY: 0,
        bleedInches: shapeData.bleedInches,
        contourCanvasWidth: 1,
        contourCanvasHeight: 1,
        imageCanvasX: 0,
        imageCanvasY: 0,
        imageCanvasWidth: 1,
        imageCanvasHeight: 1,
      });
    } else {
      console.warn('[AddContour] No contour data available');
      toast({
        title: "No contour available",
        description: "Please wait for the contour to finish generating before adding another.",
        variant: "destructive",
      });
      setShowApplyAddDropdown(false);
      return;
    }

    setCutContourLabel(newLabel);
    setShowApplyAddDropdown(false);
  }, [cutContourLabel, toast, imageInfo, shapeSettings, resizeSettings]);

  const applyImageDirectly = useCallback((newImageInfo: ImageInfo, widthInches: number, heightInches: number) => {
    const isFirstDesign = designs.length === 0;
    const offset = designs.length * 0.05;
    const newTransform = { nx: Math.min(0.5 + offset, 0.85), ny: Math.min(0.5 + offset, 0.85), s: 1, rotation: 0 };

    if (isFirstDesign) {
      setImageInfo(newImageInfo);

      const SHAPE_CONFIDENCE_THRESHOLD = 0.88;
      const detectionResult = detectShape(newImageInfo.image);
      const detectedShapeType = mapDetectedShapeToType(detectionResult.shape);
      const shouldAutoApplyShape = detectedShapeType !== null && detectionResult.confidence >= SHAPE_CONFIDENCE_THRESHOLD;

      setStrokeSettings({
        width: 0.14,
        color: "#ffffff",
        enabled: !shouldAutoApplyShape,
        alphaThreshold: 128,
        backgroundColor: "#ffffff",
        useCustomBackground: true,
        cornerMode: 'rounded',
        autoBridging: true,
        autoBridgingThreshold: 0.02,
        contourMode: undefined,
      });
      setDetectedAlgorithm(undefined);

      const autoType = detectedShapeType || 'square';
      const isCircularType = autoType === 'circle' || autoType === 'oval';
      const newShapeSettings: ShapeSettings = {
        enabled: shouldAutoApplyShape,
        type: autoType,
        offset: isCircularType ? 0.05 : 0.25,
        fillColor: '#FFFFFF',
        strokeEnabled: false,
        strokeWidth: 2,
        strokeColor: '#000000',
        cornerRadius: 0.25,
      };
      setShapeSettings(newShapeSettings);

      setDetectedShapeType(detectedShapeType);
      setDetectedShapeInfo(detectedShapeType ? {
        type: detectedShapeType,
        boundingBox: detectionResult.boundingBox
      } : null);

      if (shouldAutoApplyShape) {
        setStrokeMode('shape');
      } else {
        setStrokeMode('contour');
      }
      setCadCutBounds(null);
      setLockedContour(null);
      setDesignTransform(newTransform);

      setResizeSettings(prev => ({
        ...prev,
        widthInches,
        heightInches,
      }));

      const maxDim = Math.max(widthInches, heightInches);
      const validSizes: StickerSize[] = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5];
      const fittingSize = validSizes.find(size => size >= maxDim) || 5.5;
      setStickerSize(fittingSize as StickerSize);

      const shapeDims = calculateShapeDimensions(
        widthInches,
        heightInches,
        newShapeSettings.type,
        newShapeSettings.offset
      );
      updateCadCutBounds(shapeDims.widthInches, shapeDims.heightInches, newShapeSettings);
    } else {
      setImageInfo(newImageInfo);
      setDesignTransform(newTransform);
      setResizeSettings(prev => ({
        ...prev,
        widthInches,
        heightInches,
      }));
    }

    const newDesignId = crypto.randomUUID();
    const newDesignItem: DesignItem = {
      id: newDesignId,
      imageInfo: newImageInfo,
      transform: newTransform,
      widthInches,
      heightInches,
      name: newImageInfo.file.name,
      originalDPI: newImageInfo.dpi,
    };
    setDesigns(prev => [...prev, newDesignItem]);
    setSelectedDesignId(newDesignId);
  }, [updateCadCutBounds, designs.length]);

  const handleImageUpload = useCallback((file: File, image: HTMLImageElement) => {
    try {
      if (image.width * image.height > 1000000000) {
        alert('Image is too large. Please upload an image smaller than 1000 megapixels.');
        return;
      }
      
      if (image.width <= 0 || image.height <= 0) {
        alert('Invalid image dimensions.');
        return;
      }
      
      const croppedCanvas = cropImageToContent(image);
      if (!croppedCanvas) {
        console.error('Failed to crop image, using original');
        handleFallbackImage(file, image);
        return;
      }
      
      const croppedImage = new Image();
      
      croppedImage.onload = () => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        
        const dpi = 300;
        const MAX_STORED_DIMENSION = 4000;
        let finalImage = croppedImage;
        let finalWidth = croppedImage.width;
        let finalHeight = croppedImage.height;
        
        const maxDim = Math.max(croppedImage.width, croppedImage.height);
        if (maxDim > MAX_STORED_DIMENSION) {
          const scale = MAX_STORED_DIMENSION / maxDim;
          finalWidth = Math.round(croppedImage.width * scale);
          finalHeight = Math.round(croppedImage.height * scale);
          
          console.log(`[Upload] Downsampling from ${croppedImage.width}x${croppedImage.height} to ${finalWidth}x${finalHeight}`);
          
          const downsampleCanvas = document.createElement('canvas');
          downsampleCanvas.width = finalWidth;
          downsampleCanvas.height = finalHeight;
          const dsCtx = downsampleCanvas.getContext('2d')!;
          dsCtx.imageSmoothingEnabled = true;
          dsCtx.imageSmoothingQuality = 'high';
          dsCtx.drawImage(croppedImage, 0, 0, finalWidth, finalHeight);
          
          finalImage = new Image();
          finalImage.src = downsampleCanvas.toDataURL('image/png');
        }
        
        const processImage = () => {
          const newImageInfo: ImageInfo = {
            file,
            image: finalImage,
            originalWidth: finalWidth,
            originalHeight: finalHeight,
            dpi,
          };
          
          const widthInches = parseFloat((finalWidth / dpi).toFixed(2));
          const heightInches = parseFloat((finalHeight / dpi).toFixed(2));
          
          applyImageDirectly(newImageInfo, widthInches, heightInches);

          const effectiveDPI = Math.min(finalWidth / widthInches, finalHeight / heightInches);
          if (effectiveDPI < 278) {
            toast({
              title: "Low Resolution Warning",
              description: `This image is approximately ${Math.round(effectiveDPI)} DPI at the current size. For best print quality, we recommend at least 300 DPI. The image might come out low resolution.`,
              variant: "destructive",
            });
          }
        };
        
        if (finalImage === croppedImage) {
          processImage();
        } else {
          finalImage.onload = processImage;
        }
      };
      
      croppedImage.onerror = () => {
        console.error('Error loading cropped image, using original');
        handleFallbackImage(file, image);
      };
      
      croppedImage.src = croppedCanvas.toDataURL('image/png');
    } catch (error) {
      console.error('Error processing uploaded image:', error);
      handleFallbackImage(file, image);
    }
  }, [applyImageDirectly]);

  const handleFallbackImage = useCallback((file: File, image: HTMLImageElement) => {
    const dpi = 300;
    
    const croppedCanvas = cropImageToContent(image);
    const finalImage = croppedCanvas ? (() => {
      const img = new Image();
      img.src = croppedCanvas.toDataURL();
      return img;
    })() : image;

    const processImage = () => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      
      const widthInches = parseFloat((finalImage.width / dpi).toFixed(2));
      const heightInches = parseFloat((finalImage.height / dpi).toFixed(2));

      const newImageInfo: ImageInfo = {
        file,
        image: finalImage,
        originalWidth: finalImage.width,
        originalHeight: finalImage.height,
        dpi,
      };

      applyImageDirectly(newImageInfo, widthInches, heightInches);

      const effectiveDPI = Math.min(finalImage.width / widthInches, finalImage.height / heightInches);
      if (effectiveDPI < 278) {
        toast({
          title: "Low Resolution Warning",
          description: `This image is approximately ${Math.round(effectiveDPI)} DPI at the current size. For best print quality, we recommend at least 300 DPI. The image might come out low resolution.`,
          variant: "destructive",
        });
      }
    };

    if (croppedCanvas) {
      finalImage.onload = processImage;
    } else {
      processImage();
    }
  }, [applyImageDirectly, toast]);

  const handlePDFUpload = useCallback((file: File, pdfData: ParsedPDFData) => {
    // Close any open dropdowns
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    
    const { image, cutContourInfo, originalPdfData, dpi } = pdfData;
    
    // Create image info with PDF-specific data
    const newImageInfo: ImageInfo = {
      file,
      image,
      originalWidth: image.width,
      originalHeight: image.height,
      dpi,
      isPDF: true,
      pdfCutContourInfo: cutContourInfo,
      originalPdfData,
    };
    
    setImageInfo(newImageInfo);
    
    setStrokeSettings({
      width: 0.14,
      color: "#ffffff",
      enabled: false,
      alphaThreshold: 128,
      backgroundColor: "#ffffff",
      useCustomBackground: true,
      cornerMode: 'rounded',
      autoBridging: true,
      autoBridgingThreshold: 0.02,
      contourMode: undefined,
    });
    setDetectedAlgorithm(undefined);
    setShapeSettings({
      enabled: false,
      type: 'square',
      offset: 0.25,
      fillColor: '#FFFFFF',
      strokeEnabled: false,
      strokeWidth: 2,
      strokeColor: '#000000',
      cornerRadius: 0.25,
    });
    
    // If PDF has CutContour, set mode to 'contour' but disable generation
    if (cutContourInfo.hasCutContour) {
      setStrokeMode('none'); // Keep as none since contour is in file
    } else {
      setStrokeMode('none');
    }
    
    setCadCutBounds(null);
    setStickerSize(4);
    
    // Calculate dimensions
    let { widthInches, heightInches } = calculateImageDimensions(image.width, image.height, dpi);
    const maxDimension = Math.max(widthInches, heightInches);
    if (maxDimension > 4) {
      const scale = 4 / maxDimension;
      widthInches = parseFloat((widthInches * scale).toFixed(2));
      heightInches = parseFloat((heightInches * scale).toFixed(2));
    }
    
    setResizeSettings(prev => ({
      ...prev,
      widthInches,
      heightInches,
    }));
  }, []);

  const handleResizeChange = useCallback((newSettings: Partial<ResizeSettings>) => {
    setResizeSettings(prev => {
      const updated = { ...prev, ...newSettings };
      const currentImageInfo = selectedDesign?.imageInfo || imageInfo;
      
      if (updated.maintainAspectRatio && currentImageInfo && newSettings.widthInches !== undefined) {
        const aspectRatio = currentImageInfo.originalHeight / currentImageInfo.originalWidth;
        updated.heightInches = parseFloat((newSettings.widthInches * aspectRatio).toFixed(1));
      } else if (updated.maintainAspectRatio && currentImageInfo && newSettings.heightInches !== undefined) {
        const aspectRatio = currentImageInfo.originalWidth / currentImageInfo.originalHeight;
        updated.widthInches = parseFloat((newSettings.heightInches * aspectRatio).toFixed(1));
      }
      
      if (shapeSettings.enabled) {
        const shapeDims = calculateShapeDimensions(
          updated.widthInches,
          updated.heightInches,
          shapeSettings.type,
          shapeSettings.offset
        );
        updateCadCutBounds(shapeDims.widthInches, shapeDims.heightInches, shapeSettings);
      }

      if (selectedDesignId) {
        setDesigns(prevDesigns => prevDesigns.map(d => d.id === selectedDesignId ? { ...d, widthInches: updated.widthInches, heightInches: updated.heightInches } : d));
      }
      
      return updated;
    });
  }, [imageInfo, selectedDesign, selectedDesignId, shapeSettings, updateCadCutBounds]);

  const handleStickerSizeChange = useCallback((newSize: StickerSize) => {
    setStickerSize(newSize);
    
    const currentImageInfo = selectedDesign?.imageInfo || imageInfo;
    if (currentImageInfo) {
      const aspectRatio = currentImageInfo.originalWidth / currentImageInfo.originalHeight;
      let newWidth: number;
      let newHeight: number;
      
      if (aspectRatio >= 1) {
        // Wider than tall - width is the constraining dimension
        newWidth = newSize;
        newHeight = parseFloat((newSize / aspectRatio).toFixed(2));
      } else {
        // Taller than wide - height is the constraining dimension
        newHeight = newSize;
        newWidth = parseFloat((newSize * aspectRatio).toFixed(2));
      }
      
      setResizeSettings(prev => ({
        ...prev,
        widthInches: newWidth,
        heightInches: newHeight,
      }));
      
      if (selectedDesignId) {
        setDesigns(prevDesigns => prevDesigns.map(d => d.id === selectedDesignId ? { ...d, widthInches: newWidth, heightInches: newHeight } : d));
      }
      
      if (shapeSettings.enabled) {
        const shapeDims = calculateShapeDimensions(
          newWidth,
          newHeight,
          shapeSettings.type,
          shapeSettings.offset
        );
        updateCadCutBounds(shapeDims.widthInches, shapeDims.heightInches, shapeSettings);
      }
    }
  }, [imageInfo, selectedDesign, selectedDesignId, shapeSettings, updateCadCutBounds]);

  const handleRemoveBackground = useCallback(async (threshold: number) => {
    const currentImageInfo = selectedDesign?.imageInfo || imageInfo;
    if (!currentImageInfo) return;
    
    setIsRemovingBackground(true);
    try {
      const bgRemovedImage = await removeBackgroundFromImage(currentImageInfo.image, threshold);
      
      const croppedCanvas = cropImageToContent(bgRemovedImage);
      if (!croppedCanvas) {
        console.error('Failed to crop image after background removal');
        setIsRemovingBackground(false);
        return;
      }
      
      const finalImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = croppedCanvas.toDataURL('image/png');
      });
      
      const newWidth = finalImage.naturalWidth || finalImage.width;
      const newHeight = finalImage.naturalHeight || finalImage.height;
      
      const newImageInfo: ImageInfo = {
        ...currentImageInfo,
        image: finalImage,
        originalWidth: newWidth,
        originalHeight: newHeight,
      };
      
      const dpi = currentImageInfo.dpi || 300;
      let { widthInches, heightInches } = calculateImageDimensions(newWidth, newHeight, dpi);
      
      const maxDimension = Math.max(widthInches, heightInches);
      if (maxDimension > stickerSize) {
        const scale = stickerSize / maxDimension;
        widthInches = parseFloat((widthInches * scale).toFixed(2));
        heightInches = parseFloat((heightInches * scale).toFixed(2));
      }
      
      setResizeSettings(prev => ({
        ...prev,
        widthInches,
        heightInches,
      }));
      
      const workerManager = getContourWorkerManager();
      workerManager.clearCache();
      setCadCutBounds(null);
      
      console.log(`[BackgroundRemoval] Complete! Original: ${currentImageInfo.originalWidth}x${currentImageInfo.originalHeight}, New: ${newWidth}x${newHeight}`);
      
      setImageInfo(newImageInfo);
      
      if (selectedDesignId) {
        setDesigns(prev => prev.map(d => d.id === selectedDesignId ? { ...d, imageInfo: newImageInfo, widthInches, heightInches } : d));
      }
      
      toast({
        title: "Background Removed",
        description: "White background removed from edges. Select Contour to see the new outline.",
      });
    } catch (error) {
      console.error('Error removing background:', error);
      toast({
        title: "Error",
        description: "Failed to remove background. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRemovingBackground(false);
    }
  }, [imageInfo, selectedDesign, selectedDesignId, stickerSize]);

  const handleStrokeChange = useCallback((newSettings: Partial<StrokeSettings>) => {
    const updated = { ...strokeSettings, ...newSettings };
    
    // If enabling stroke, disable shape for mutual exclusion
    if (newSettings.enabled === true) {
      setShapeSettings(prev => ({ ...prev, enabled: false }));
    }
    
    setStrokeSettings(updated);
  }, [strokeSettings]);

  const handleShapeChange = useCallback((newSettings: Partial<ShapeSettings>) => {
    let updated = { ...shapeSettings, ...newSettings };
    
    // If enabling shape, disable stroke for mutual exclusion
    if (newSettings.enabled === true) {
      setStrokeSettings(prev => ({ ...prev, enabled: false }));
    }
    
    // Auto-reset offset when switching between shape type categories
    if (newSettings.type !== undefined && newSettings.type !== shapeSettings.type) {
      const wasCircular = shapeSettings.type === 'circle' || shapeSettings.type === 'oval';
      const isCircular = newSettings.type === 'circle' || newSettings.type === 'oval';
      
      if (wasCircular !== isCircular) {
        // Switch to appropriate default offset for new shape category
        updated.offset = isCircular ? 0.05 : 0.125; // Tight fit for circular, Small for rectangular
      }
    }
    
    setShapeSettings(updated);
    
    // Recalculate bounds with auto-sized shape dimensions - pass updated settings to avoid stale closure
    if (updated.enabled && imageInfo) {
      const shapeDims = calculateShapeDimensions(
        resizeSettings.widthInches,
        resizeSettings.heightInches,
        updated.type,
        updated.offset
      );
      updateCadCutBounds(shapeDims.widthInches, shapeDims.heightInches, updated);
    }
  }, [shapeSettings, imageInfo, resizeSettings, updateCadCutBounds]);



  const handleDownload = useCallback(async (downloadType: 'standard' | 'highres' | 'vector' | 'cutcontour' | 'design-only' | 'download-package' = 'standard', format: VectorFormat = 'png', spotColors?: SpotColorInput[], singleArtboard: boolean = false) => {
    const currentImageInfo = selectedDesign?.imageInfo || imageInfo;
    if (!currentImageInfo || !canvasRef.current) return;
    
    setIsProcessing(true);
    
    try {
      // Handle PDF with existing CutContour - generate proper vector CutContour PDF
      if (currentImageInfo.isPDF && currentImageInfo.pdfCutContourInfo?.hasCutContour && downloadType === 'cutcontour') {
        const { generatePDFWithVectorCutContour } = await import('@/lib/pdf-parser');
        const nameWithoutExt = currentImageInfo.file.name.replace(/\.[^/.]+$/, '');
        await generatePDFWithVectorCutContour(
          currentImageInfo.image,
          currentImageInfo.pdfCutContourInfo.cutContourPoints,
          currentImageInfo.pdfCutContourInfo.pageWidth,
          currentImageInfo.pdfCutContourInfo.pageHeight,
          currentImageInfo.dpi || 300,
          `${nameWithoutExt}_with_cutcontour.pdf`,
          cutContourLabel
        );
        setIsProcessing(false);
        return;
      }
      if (downloadType === 'download-package') {
        // Create zip package with original and cutlines
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Calculate output dimensions using auto-sizing
        const shapeDims = calculateShapeDimensions(
          resizeSettings.widthInches,
          resizeSettings.heightInches,
          shapeSettings.type,
          shapeSettings.offset
        );
        const outputWidth = shapeDims.widthInches * 300;
        const outputHeight = shapeDims.heightInches * 300;
        
        canvas.width = outputWidth;
        canvas.height = outputHeight;

        // Draw shape background
        // Holographic fill downloads as transparent (preview only) - skip fill entirely
        const isHolographicFill = shapeSettings.fillColor === 'holographic';
        ctx.beginPath();
        
        if (shapeSettings.type === 'circle') {
          const radius = Math.min(outputWidth, outputHeight) / 2;
          const centerX = outputWidth / 2;
          const centerY = outputHeight / 2;
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        } else if (shapeSettings.type === 'oval') {
          const centerX = outputWidth / 2;
          const centerY = outputHeight / 2;
          ctx.ellipse(centerX, centerY, outputWidth / 2, outputHeight / 2, 0, 0, Math.PI * 2);
        } else if (shapeSettings.type === 'square') {
          const size = Math.min(outputWidth, outputHeight);
          const startX = (outputWidth - size) / 2;
          const startY = (outputHeight - size) / 2;
          ctx.rect(startX, startY, size, size);
        } else {
          ctx.rect(0, 0, outputWidth, outputHeight);
        }
        
        // Only fill if not holographic - holographic downloads as transparent
        if (!isHolographicFill) {
          ctx.fillStyle = shapeSettings.fillColor;
          ctx.fill();
        }

        // Draw cutlines in magenta
        ctx.strokeStyle = '#FF00FF';
        ctx.lineWidth = 2;
        ctx.stroke();

        const croppedCanvas = cropImageToContent(currentImageInfo.image);
        const finalImage = croppedCanvas ? (() => {
          const img = new Image();
          img.src = croppedCanvas.toDataURL();
          return img;
        })() : currentImageInfo.image;

        // Wait for cropped image to load if created
        if (croppedCanvas) {
          await new Promise((resolve) => {
            finalImage.onload = resolve;
          });
        }

        const imageWidth = resizeSettings.widthInches * 300;
        const imageHeight = resizeSettings.heightInches * 300;
        
        const imageX = (outputWidth - imageWidth) / 2;
        const imageY = (outputHeight - imageHeight) / 2;
        
        ctx.save();
        ctx.beginPath();
        if (shapeSettings.type === 'circle') {
          const clipRadius = Math.min(outputWidth, outputHeight) / 2;
          ctx.arc(outputWidth / 2, outputHeight / 2, clipRadius, 0, Math.PI * 2);
        } else if (shapeSettings.type === 'oval') {
          ctx.ellipse(outputWidth / 2, outputHeight / 2, outputWidth / 2, outputHeight / 2, 0, 0, Math.PI * 2);
        } else {
          ctx.rect(0, 0, outputWidth, outputHeight);
        }
        ctx.clip();
        ctx.drawImage(finalImage, imageX, imageY, imageWidth, imageHeight);
        ctx.restore();

        const nameWithoutExt = currentImageInfo.file.name.replace(/\.[^/.]+$/, '');
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${nameWithoutExt}_final_design.png`;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }
        }, 'image/png');
        
      } else if (downloadType === 'cutcontour') {
        // Generate magenta vector path along transparent pixel boundaries
        await new Promise(resolve => setTimeout(resolve, 100)); // UI feedback delay
        
        const magentaCutCanvas = createVectorStroke(currentImageInfo.image, {
          strokeSettings: { ...strokeSettings, color: '#FF00FF', enabled: true }, // Force magenta
          exportCutContour: true, // Enable cut contour mode
          vectorQuality: 'high' // High quality for precise cutting paths
        });
        
        // Download the magenta cut contour
        magentaCutCanvas.toBlob((blob: Blob | null) => {
          if (!blob) return;
          
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'magenta_cut_contour.png';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }, 'image/png');
        
        // Also generate vector formats for cutting machines
        const vectorPaths = createVectorPaths(currentImageInfo.image, {
          ...strokeSettings, 
          color: '#FF00FF', 
          enabled: true
        });
        
        // Download additional vector formats based on requested format
        if (format === 'svg') {
          downloadVectorStroke(magentaCutCanvas, 'cut_contour.svg', 'svg', vectorPaths);
        } else if (format === 'eps') {
          downloadVectorStroke(magentaCutCanvas, 'cut_contour.eps', 'eps', vectorPaths);
        }
      } else {
        const nameWithoutExt = currentImageInfo.file.name.replace(/\.[^/.]+$/, '');
        
        if (strokeSettings.enabled) {
          // Contour mode: Download PDF with raster image + vector contour
          const filename = `${nameWithoutExt}_with_contour.pdf`;
          
          // Get cached contour data from worker manager for fast PDF export
          const workerManager = getContourWorkerManager();
          const cachedData = workerManager.getCachedContourData() as CachedContourData | undefined;
          
          await downloadContourPDF(
            currentImageInfo.image,
            strokeSettings,
            resizeSettings,
            filename,
            cachedData,
            spotColors,
            singleArtboard,
            cutContourLabel,
            lockedContour ? { label: lockedContour.label, pathPoints: lockedContour.pathPoints, widthInches: lockedContour.widthInches, heightInches: lockedContour.heightInches } : null
          );
        } else if (shapeSettings.enabled) {
          // Shape background mode: Download PDF with shape + CutContour spot color
          const filename = `${nameWithoutExt}_with_shape.pdf`;
          await downloadShapePDF(
            currentImageInfo.image,
            shapeSettings,
            resizeSettings,
            filename,
            spotColors,
            singleArtboard,
            cutContourLabel,
            lockedContour ? { label: lockedContour.label, pathPoints: lockedContour.pathPoints, widthInches: lockedContour.widthInches, heightInches: lockedContour.heightInches, imageOffsetX: lockedContour.imageOffsetX, imageOffsetY: lockedContour.imageOffsetY } : null
          );
        } else {
          // No mode selected - just download the image
          const dpi = 300;
          const filename = `${nameWithoutExt}.png`;
          await downloadCanvas(
            currentImageInfo.image,
            strokeSettings,
            resizeSettings.widthInches,
            resizeSettings.heightInches,
            dpi,
            filename,
            undefined
          );
        }
      }
    } catch (error) {
      console.error("Download failed:", error);
      console.error("Error details:", {
        hasImage: !!currentImageInfo,
        hasCanvas: !!canvasRef.current,
        shapeSettings,
        resizeSettings,
        strokeSettings
      });
      alert(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`);
    } finally {
      setIsProcessing(false);
    }
  }, [imageInfo, selectedDesign, strokeSettings, resizeSettings, shapeSettings, cutContourLabel]);

  // Empty state - no image uploaded
  if (!activeImageInfo) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center bg-black">
        <div className="w-full max-w-xl mx-auto transition-all duration-300">
          <UploadSection 
            onImageUpload={handleImageUpload}
            showCutLineInfo={false}
            imageInfo={null}
            resizeSettings={resizeSettings}
            stickerSize={stickerSize}
          />
        </div>
      </div>
    );
  }

  // Loaded state - image uploaded
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Left sidebar - Settings */}
      <div className="lg:col-span-4 xl:col-span-3 space-y-3" style={{ boxShadow: '0 0 15px rgba(255,255,255,0.3), 0 0 30px rgba(255,255,255,0.15)' }}>
        <ControlsSection
          strokeSettings={strokeSettings}
          resizeSettings={activeResizeSettings}
          shapeSettings={shapeSettings}
          stickerSize={stickerSize}
          onStrokeChange={handleStrokeChange}
          onResizeChange={handleResizeChange}
          onShapeChange={handleShapeChange}
          onStickerSizeChange={handleStickerSizeChange}
          onDownload={handleDownload}
          isProcessing={isProcessing}
          imageInfo={activeImageInfo}
          canvasRef={canvasRef}
          onStepChange={() => {}}
          onSpotPreviewChange={setSpotPreviewData}
          artboardWidth={artboardWidth}
          artboardHeight={artboardHeight}
          onArtboardHeightChange={setArtboardHeight}
        />
      </div>
      
      {/* Right area - Upload, Info, and Preview */}
      <div className="lg:col-span-8 xl:col-span-9" style={{ boxShadow: '0 0 15px rgba(255,255,255,0.3), 0 0 30px rgba(255,255,255,0.15)' }}>
        <div className="sticky top-4 space-y-3">
          {/* Top row: Add Design and Image Info - compact bar */}
          <div className="flex items-center gap-2 bg-gray-900 rounded-lg border border-gray-700 shadow-sm px-3 py-2" style={{ boxShadow: '0 0 15px rgba(255,255,255,0.3), 0 0 30px rgba(255,255,255,0.15)' }}>
            <UploadSection 
              onImageUpload={handleImageUpload}
              showCutLineInfo={false}
              imageInfo={activeImageInfo}
              resizeSettings={activeResizeSettings}
              stickerSize={stickerSize}
            />
            
            {activeImageInfo && (
              <>
                <div className="w-px h-6 bg-gray-700"></div>
                
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {activeImageInfo?.file?.name && (
                    <p className="text-xs text-gray-400 truncate max-w-[120px]" title={activeImageInfo.file.name}>
                      {activeImageInfo.file.name}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-gray-300">{(activeResizeSettings.widthInches * activeDesignTransform.s).toFixed(1)}"</span>
                    <span className="text-gray-500">×</span>
                    <span className="text-sm font-semibold text-gray-300">{(activeResizeSettings.heightInches * activeDesignTransform.s).toFixed(1)}"</span>
                  </div>
                  <span className="text-[10px] text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">{activeResizeSettings.outputDPI} DPI</span>
                </div>

              </>
            )}
          </div>

          {/* Design Info Dropdown */}
          {designs.length > 0 && (
            <div ref={designInfoRef} className="relative">
              <button
                onClick={() => setShowDesignInfo(!showDesignInfo)}
                className="flex items-center gap-2 w-full bg-gray-900 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              >
                <Info className="w-4 h-4" />
                <span>Design Info ({designs.length})</span>
                {showDesignInfo ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
              </button>
              {showDesignInfo && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 max-h-[240px] overflow-y-auto">
                  {designs.map(d => (
                    <div
                      key={d.id}
                      className={`flex items-center justify-between px-3 py-2.5 cursor-pointer transition-colors ${d.id === selectedDesignId ? 'bg-gray-700 border-l-2 border-cyan-500' : 'hover:bg-gray-700/50 border-l-2 border-transparent'}`}
                      onClick={() => { handleSelectDesign(d.id); setShowDesignInfo(false); }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-white truncate">{d.name}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {(d.widthInches * d.transform.s).toFixed(1)}" × {(d.heightInches * d.transform.s).toFixed(1)}" | {d.originalDPI} DPI
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteDesign(d.id); }}
                        className="ml-2 p-1 rounded hover:bg-gray-600 text-gray-500 hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Preview */}
          <div className="relative">
            <PreviewSection
              ref={canvasRef}
              imageInfo={activeImageInfo}
              strokeSettings={debouncedStrokeSettings}
              resizeSettings={activeResizeSettings}
              shapeSettings={debouncedShapeSettings}
              cadCutBounds={cadCutBounds}
              spotPreviewData={spotPreviewData}
              showCutLineInfo={false}
              detectedShapeType={detectedShapeType}
              detectedShapeInfo={detectedShapeInfo}
              onStrokeChange={handleStrokeChange}
              lockedContour={lockedContour}
              artboardWidth={artboardWidth}
              artboardHeight={artboardHeight}
              designTransform={activeDesignTransform}
              onTransformChange={handleDesignTransformChange}
              designs={designs}
              selectedDesignId={selectedDesignId}
              onSelectDesign={handleSelectDesign}
            />
            {selectedDesignId && (
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 z-10">
                <button
                  onClick={handleDuplicateDesign}
                  className="p-2 rounded-lg bg-gray-900/80 border border-gray-600 hover:bg-gray-700/80 hover:border-cyan-500 text-gray-400 hover:text-cyan-400 transition-colors"
                  title="Duplicate Design"
                >
                  <Copy className="w-5 h-5" />
                </button>
                <button
                  onClick={() => handleDeleteDesign(selectedDesignId)}
                  className="p-2 rounded-lg bg-gray-900/80 border border-red-800 hover:bg-red-900/80 hover:border-red-500 text-red-500 hover:text-red-400 transition-colors"
                  title="Delete Design"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Processing Modal */}
      {isProcessing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-sm mx-4">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-cyan-500 border-t-transparent"></div>
              <span className="text-white">Processing...</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

# Sticker Maker App

## Overview

This is a full-stack web application for creating customizable stickers from PNG images. Users can upload images, add white outlines, adjust stroke settings, resize images in inches, and download high-quality 300 DPI print-ready files. The application offers features like shape backgrounds, precise contour generation, and various download modes for professional printing and cutting.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **UI**: Tailwind CSS with shadcn/ui components, responsive design
- **State Management**: React hooks and TanStack Query
- **Routing**: Wouter
- **Image Processing**: HTML5 Canvas API for real-time preview and stroke effects

### Backend
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ES modules
- **File Processing**: Multer for uploads, Sharp for image manipulation
- **Development**: tsx

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM for user management
- **Session Storage**: In-memory storage (development)
- **File Storage**: Temporary in-memory processing for uploads

### Key Features and Design Decisions
- **Image Processing Pipeline**: Drag-and-drop upload, real-time canvas preview, customizable stroke (width, color, enable/disable), shape backgrounds (square, rectangle, circle, oval with fill colors and strokes), and high-resolution export.
- **Canvas Rendering**: Custom stroke algorithms using Clipper.js library for mathematically correct polygon offsetting, real-time preview, high-resolution export canvas.
- **Contour Generation**: True alpha channel edge detection, CadCut-style bounds detection, vector contour tracing using Clipper.js-based Minkowski sum offset with proper boundary tracing (Moore neighbor algorithm), support for interior holes with adjustable margins, single continuous outline generation for multi-object images, advanced alpha threshold control. Shape-aware contour: when an image is auto-detected as a geometric shape (circle, oval, square, rectangle), contour mode reuses the same perfect geometric outline instead of alpha tracing, ensuring consistent cut paths in both preview and PDF export. Uses `DetectedShapeInfo` (type + boundingBox) for precise centering based on actual content bounds; 256-point polygons for smooth circles/ovals.
- **Contour Mode System**: 2-mode algorithm selector (`ContourMode = 'smooth' | 'scattered'`). Smart auto-detection picks the best mode; users can override manually via UI buttons. UI labels: "Sharp" (internal key: smooth) = rounded corners for curved designs (default for most images), "Smooth" (internal key: scattered) = gap-bridging for multi-element designs with Chaikin smoothing. Auto-detection analyzes design complexity and scattered layout to choose the appropriate mode. Sharp mode includes composite shape fitting (`composite-shape-fit.ts`): detects if contour has a round body + rectangular tab, fits an ellipse to the body and a right-angle rectangle to the tab, then reconnects with clean tangent joins. Falls back to original traced contour if no composite pattern is detected.
- **Download System**: Multiple download modes (Standard, High-res, Vector Quality, CutContour), true vector export formats (PDF, EPS, SVG) with edge tracing, CutContour export with magenta spot color. PDF CutContour uses pathPoints (inch coordinates) converted to PDF points via ×72. Uses line segments with RDP simplification (epsilon=0.005 inches) for clean vector paths. Editable spot color label (CutContour/PerfCutContour/KissCut) stored as `cutContourLabel` state in image-editor.tsx, threaded through all PDF export functions via parameter.
- **Spot Color Vectors (RDG_WHITE/RDG_GLOSS)**: Users can tag extracted design colors as "White" or "Gloss" via checkboxes in the color list. Tagged colors are traced as vector regions (`spot-color-vectors.ts`): closest-color matching assigns each pixel to its nearest extracted color (tolerance 60, alpha threshold 240), edges are traced with Moore neighbor boundary following, smoothed, simplified via RDP (epsilon 0.005), and written to the PDF as filled vector paths under PDF Separation color spaces. Spot color names default to RDG_WHITE/RDG_GLOSS but are user-editable. Both `downloadContourPDF` and `downloadShapePDF` accept spot color data and call `addSpotColorVectorsToPDF` to write the layers. `singleArtboard` parameter controls whether spot color layers are added to the same page or separate pages. `SpotColorInput` type defined in `contour-outline.ts`, shared across all export files. Path ops use `cs`/`scn` (fill color space) with `f` (fill) operator, wrapped in `q`/`Q` graphics state save/restore.
- **Dual Contour System**: Users can lock the current contour via "Apply and Add.." button and generate a second contour with a different spot color label. Locked contour renders as blue (#3B82F6) dashed line in preview; active contour renders as magenta. PDF export creates separate Separation color spaces for each contour label. `LockedContour` type stores pathPoints, previewPathPoints, contourCanvasWidth/Height, and label. When both contours share the same label, the locked contour reuses the existing color space but still adds its path.
- **UI/UX**: Dark grey application theme, toast notifications, form validation, draggable and responsive controls, zoom functionality with "Fit to View", manual position control for design placement.
- **Image Cropping**: Automatic empty space removal and content-aware cropping for precise boundary detection.
- **Design Logic**: Mutual exclusion between contour outline and shape background modes, dynamic UI controls for shape sizing, and automatic design clipping to prevent out-of-bounds rendering.

## External Dependencies

- **@neondatabase/serverless**: PostgreSQL database connectivity
- **drizzle-orm**: Type-safe database ORM
- **@tanstack/react-query**: Server state management
- **sharp**: High-performance image processing
- **multer**: File upload middleware
- **clipper-lib**: Angus Johnson's Clipper library for robust polygon offsetting (Minkowski sum)
- **@radix-ui**: Accessible UI primitives
- **tailwindcss**: Utility-first CSS framework
- **lucide-react**: Icon library
- **class-variance-authority**: Component variant management

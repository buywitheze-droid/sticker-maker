# Sticker Maker App

## Overview

This is a full-stack web application for creating stickers by adding customizable white outlines to PNG images. Users can upload images, adjust stroke settings, resize their images in inches, and download high-quality 300 DPI files for printing.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite for fast development and optimized builds
- **UI Framework**: Tailwind CSS with shadcn/ui components
- **State Management**: React hooks and TanStack Query for server state
- **Routing**: Wouter for lightweight client-side routing
- **Canvas Manipulation**: HTML5 Canvas API for image processing and stroke effects

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ES modules
- **File Processing**: Multer for file uploads, Sharp for image processing
- **Development**: tsx for TypeScript execution in development

### Data Storage Solutions
- **Database**: PostgreSQL with Drizzle ORM
- **Schema**: User management with username/password authentication
- **Session Storage**: In-memory storage for development (MemStorage class)
- **File Storage**: Temporary in-memory processing for uploaded images

## Key Components

### Image Processing Pipeline
1. **Upload Section**: Drag-and-drop PNG file upload with validation
2. **Preview Section**: Real-time canvas preview with stroke effects
3. **Controls Section**: Stroke width, color, and resize settings
4. **Download System**: High-resolution image export at specified DPI

### Canvas Rendering System
- Custom stroke algorithm using multiple offset rendering
- Real-time preview with scaling and positioning
- High-resolution export canvas for print quality

### UI Components
- Comprehensive shadcn/ui component library
- Responsive design with mobile support
- Toast notifications for user feedback
- Form controls with validation

## Data Flow

1. User uploads PNG image via drag-and-drop or file picker
2. Image is validated and loaded into HTML Image element
3. Canvas renderer draws image with stroke effects in real-time
4. User adjusts stroke settings (width, color, enable/disable)
5. User configures output dimensions in inches and DPI
6. Download process creates high-resolution canvas and exports PNG

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: PostgreSQL database connectivity
- **drizzle-orm**: Type-safe database ORM
- **@tanstack/react-query**: Server state management
- **sharp**: High-performance image processing
- **multer**: File upload middleware

### UI Dependencies
- **@radix-ui**: Accessible UI primitives
- **tailwindcss**: Utility-first CSS framework
- **lucide-react**: Icon library
- **class-variance-authority**: Component variant management

## Deployment Strategy

### Development Environment
- Replit-based development with hot reload
- Vite dev server with Express backend proxy
- PostgreSQL module for database development

### Production Build
- Vite builds optimized client bundle to `dist/public`
- esbuild compiles server to `dist/index.js`
- Static file serving from Express for SPA delivery

### Deployment Configuration
- Auto-scaling deployment target
- Port 5000 for local development, port 80 for external access
- Environment variables for database connection

## Recent Changes

- **June 20, 2025**: Enhanced preview section with background color options and zoom functionality
  - Added 8 background color options (transparent, white, black, grays, blue, red, green)
  - Implemented zoom controls (50% to 300% range) with zoom percentage display
  - Added scrollable preview area for zoomed-in inspection

- **June 20, 2025**: Implemented vector-quality stroke processing and automatic image cropping
  - Added automatic empty space removal using content-aware cropping
  - Created morphological dilation algorithm for precise, clean outline generation
  - Implemented vector-quality stroke processing with distance field computation
  - Added CutContour export feature with magenta spot color for cutting guides
  - Introduced 4 download modes: Standard, High-res (300 DPI), Vector Quality, and CutContour
  - Added true vector export formats: PDF, EPS, and SVG with edge tracing algorithms
  - Created vector path generation from bitmap outlines for cutting machine compatibility

- **June 20, 2025**: Added shape background functionality
  - Implemented square, rectangle, and circle shape options
  - Added shape positioning that centers the design within the selected shape
  - Created configurable shape fill colors and stroke options
  - Maintained original stroke functionality for the centered image design
  - Added real-time preview showing image centered within chosen shape background
  - Implemented mutual exclusion between shape background and white outline modes
  - Enhanced zoom controls to maintain image centering during zoom operations
  - Redesigned UI with separate card windows for "Contour/Outline" and "Shape Background" options
  - Renamed "White Outline" to "Contour" for better user clarity
  - Added visual feedback with colored borders when options are enabled
  - Implemented side-by-side layout showing both options with automatic mutual exclusion
  - Simplified download options to single "PNG file with cutlines" button for cutting machines
  - Fixed export sizing bug where images exported at wrong dimensions (e.g., 10.6" exporting as 44")
  - Set shape stroke to be disabled by default for cleaner shape backgrounds
  - Cutcontour export now forces magenta (#FF00FF) cutlines and respects resize settings
  - Added image resize controls directly within Shape Background section with auto-sync
  - Updated preview to show live changes while adjusting design size in real-time
  - Reverted to simple CadCut-style outline generation for better compatibility
  - Added basic binary mask creation from alpha channel for clean edge detection
  - Implemented simple edge pixel detection with 4-directional neighbor checking
  - Applied straightforward offset calculation for outline generation
  - Added basic pixel-to-contour connection using angular sorting from center point
  - Added shape overlap detection with red warning outline when image extends beyond shape bounds
  - Added "Fit to View" zoom control to instantly show full design centered in preview window
  - Implemented True Contour system with precise edge detection following actual image content
  - Added alpha channel edge detection to trace visible content boundaries instead of rectangular outlines
  - Created contour tracing that follows the actual shape edges for authentic design outlining
  - Fixed contour generation to produce proper image content outlines rather than boundary boxes
  - Added "Include Interior Holes" option to trace transparent areas inside designs for complex cutting paths
  - Implemented dual edge detection for both outer boundaries and interior holes with intelligent hole detection
  - Applied Flexi Auto Contour standard margins for holes with inward offset for proper cutting machine clearance
  - Added 2-pixel inward margin for holes to match professional vinyl cutting software standards
  - Modified contour system to trace only the main outer boundary, preventing interior contours inside letters/designs
  - Implemented largest contour detection to ensure only the primary design outline is traced unless holes are specifically enabled
  - Added "Fill Transparent Holes" option to automatically cover interior transparent areas with solid white background
  - Implemented intelligent hole detection using flood fill algorithm to identify gaps surrounded by solid pixels
  - Enhanced gap detection to distinguish between interior holes and outer transparency areas
  - Added region analysis to ensure only true interior gaps are filled while preserving design boundaries
  - Removed auto text background feature to fix white image upload issue
  - Fixed image processing pipeline to preserve original transparency and content
  - Implemented contour merging system to combine multiple separate elements into unified contours
  - Added flood fill region detection to identify separate design elements automatically
  - Created convex hull algorithm for complex multi-element contour generation
  - Added intelligent merging strategies based on element alignment and proximity
  - Implemented smart outline growth system where interior outlines stop when hitting content while exterior outlines grow freely
  - Added region classification to distinguish between interior and exterior design elements
  - Created constrained outline generation for interior regions that calculates maximum growth before hitting other content
  - Enhanced professional cutting path generation with intelligent boundary detection
  - Removed contour outline functionality per user request - keeping only shape background feature
  - Simplified UI to focus on shape background as the primary design option
  - Streamlined preview and image processing to eliminate complex contour generation
  - Maintained shape background functionality for centered design layouts
  - Applied dark grey theme to application background per user preference
  - Changed default preview background to dark grey instead of white
  - Maintained dark theme consistency throughout interface
  - Disabled shape background checkbox - now always enabled by default
  - Removed output information/resize window section from bottom of controls
  - Simplified interface to focus on core shape background functionality

- **June 21, 2025**: Added oval shape option to shape background functionality
  - Extended shape type options to include oval alongside existing square, rectangle, and circle options
  - Updated UI dropdown to include oval selection in controls section
  - Implemented oval rendering using HTML5 Canvas ellipse method in both preview and export functions
  - Added oval shape support to image-utils drawShapeBackground function for proper export functionality
  - Enhanced preview section to render oval shapes with correct aspect ratio and centering

- **June 21, 2025**: Implemented design tracing and bounds detection system
  - Created CadCut-style bounds detection system for reliable boundary checking
  - Added automatic edge detection using alpha channel analysis for precise design boundary tracing
  - Implemented bounds checking to detect when designs extend beyond shape boundaries
  - Added shape-specific collision detection for circle, oval, square, and rectangle shapes
  - Integrated real-time bounds checking that updates when shape settings change
  - Added automatic design clipping to prevent out-of-bounds rendering in exports
  - Changed default preview background to dark grey (#374151) for better design visibility
  - Improved UI controls: single "Size" slider for circle/square, separate width/height for oval/rectangle
  - Changed default shape fill color from magenta to white for cleaner appearance
  - Implemented automatic image tracing to vector with complete empty space removal
  - Enhanced cropping algorithm to detect and remove ALL background padding automatically
  - Updated preview to show images with zero empty space around actual content
  - Improved content detection with anti-aliasing support for precise boundary detection
  - Disabled red warning outlines for circle and oval shapes to provide cleaner preview experience
  - Reverted circle and oval boundary tolerance back to original values for standard fitting
  - Enhanced image centering to use cropped content for more accurate positioning within shapes after empty space removal
  - Added manual position control menu with 4 directional arrows in bottom-left corner for precise design placement
  - Enhanced shape background centering to always appear in center of preview window regardless of zoom level
  - Fixed position control menu functionality with proper handlePositionChange function and offset handling

## Changelog

```
Changelog:
- June 20, 2025. Initial setup with full sticker maker functionality
- June 20, 2025. Added preview enhancements: background colors and zoom controls
```

## User Preferences

```
Preferred communication style: Simple, everyday language.
```
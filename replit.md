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
- **Contour Generation**: True alpha channel edge detection, CadCut-style bounds detection, vector contour tracing using Clipper.js-based Minkowski sum offset with proper boundary tracing (Moore neighbor algorithm), support for interior holes with adjustable margins, single continuous outline generation for multi-object images, advanced alpha threshold control.
- **Perfect Shape Assist (PSA)**: Post-component-labeling shape detection stage that computes area, perimeter, circularity (4πA/P²), solidity, bbox aspect for each connected component. Shape-like components are replaced with mathematically perfect primitives (circle via Taubin fit, ellipse via covariance, rectangle via min-area rotated rect, triangle/polygon via vertex approximation). Soft union bridge merge connects small shapes near the main body using Clipper offset+union+offset-back technique. Configurable params: shapeAssistEnabled, shapeConfidenceThreshold, mergeDistInches, bridgeRadiusInches, minShapeAreaIn2.
- **Corner Modes**: Rounded corners (arc insertion at convex vertices) and sharp corners (miter joins with bevel fallback) for contour offset styling.
- **Download System**: Multiple download modes (Standard, High-res, Vector Quality, CutContour), true vector export formats (PDF, EPS, SVG) with edge tracing, CutContour export with magenta spot color. PDF CutContour uses previewPathPoints (pixel-space coordinates) as single source of truth for curve detection, then transforms to PDF points via `(px / effectiveDPI) * 72` to ensure exact match with canvas preview.
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
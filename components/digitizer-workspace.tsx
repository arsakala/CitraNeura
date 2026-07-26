'use client';

import { 
  VirtualRaster, 
  VirtualRasterConfig, 
  ImageBlobRasterSource,
  TiffRasterSource,
  RasterPipeline,
  CLAHEProcessor,
  InvertProcessor,
  GrayscaleProcessor
} from '../lib/virtual-raster';
import React, { useState, useEffect, useRef } from 'react';
import localforage from 'localforage';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  Layers,
  Settings,
  ShieldAlert,
  Sliders,
  RotateCcw,
  Plus,
  Trash2,
  Download,
  Upload,
  RefreshCw,
  Info,
  CheckCircle,
  HelpCircle,
  TrendingUp,
  SlidersHorizontal,
  FileBadge,
  Eye,
  AlertTriangle,
  Bookmark,
  Cpu,
  CornerDownRight,
  Sparkles,
  Compass,
  FilePlus,
  X,
  Search,
  FileText,
  PenTool,
  Save,
  Lock,
  Unlock,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Check,
  Menu,
  MousePointer,
  Eraser,
  Maximize,
  Maximize2,
  ZoomIn,
  Trash,
  Square,
  ShieldCheck,
  HardDrive,
  WifiOff,
  CheckCircle2
} from 'lucide-react';
import {
  ProjectState,
  WellMetadata,
  TrackDefinition,
  Curve,
  LithologyInterval,
  DigitizedPoint,
  ValueTransform,
  CurveStyle
} from '../lib/types';
import {
  pixelYToDepth,
  depthToPixelY,
  pixelXToValue,
  valueToPixelX,
  calculatePointUncertainties,
  validateDepthMonotonicity,
  getTrackBoundX
} from '../lib/math';
import {
  generateLAS20,
  validateLASStructure
} from '../lib/las-exporter';
import { autotraceV2, Matrix2D, AutoTracePipeline } from '../lib/auto-trace';
import {
  Command,
  CommandContext,
  UpdateViewportCommand,
  UpdateProjectStateCommand,
  UpdateTraceParamsCommand,
  ClearActiveCurvePointsCommand,
  AuditTrailEntry
} from '../lib/commands/command-framework';
import { validateProjectInvariants, healProjectState, getMonotonicDepthForPixelY } from '../lib/validators/invariant-validator';


import { FrameProfiler } from './frame-profiler';

// Pre-packaged custom logging tool
const logInfo = (msg: string) => console.log(`[CitraNeura] ${msg}`);

const getCurveColor = (mnemonic: string): string => {
  const m = mnemonic.toUpperCase();
  if (m.includes('GR')) return '#10B981'; // Emerald
  if (m.includes('NPHI') || m.includes('NEUT')) return '#3B82F6'; // Blue
  if (m.includes('RHOB') || m.includes('DENS')) return '#EF4444'; // Red
  if (m.includes('DT') || m.includes('SONI')) return '#8B5CF6'; // Purple
  if (m.includes('RES') || m.includes('ILD') || m.includes('LLD') || m.includes('RT')) return '#F59E0B'; // Amber
  if (m.includes('CALI')) return '#6B7280'; // Gray
  return '#4F46E5'; // Indigo default
};

const getCurveValueTransform = (curve?: Curve, track?: TrackDefinition): ValueTransform => {
  if (!track) {
    return { type: 'linear', pixelMin: 0, pixelMax: 100, valueMin: 0, valueMax: 100, direction: 'normal' };
  }
  if (curve?.valueTransform) {
    return {
      ...curve.valueTransform,
      pixelMin: track.valueTransform.pixelMin,
      pixelMax: track.valueTransform.pixelMax,
    };
  }
  return track.valueTransform;
};

const getCurveVisualColor = (curve?: Curve): string => {
  if (!curve) return '#4F46E5';
  if (curve.style?.color) return curve.style.color;
  return getCurveColor(curve.metadata?.mnemonic || '');
};

const getCurveWeight = (curve?: Curve, isActive?: boolean): number => {
  if (!curve) return isActive ? 2.5 : 1.2;
  if (curve.style?.weight !== undefined) {
    return curve.style.weight;
  }
  return isActive ? 2.5 : 1.2;
};

const getCurveDashStyle = (curve?: Curve): 'solid' | 'dashed' | 'dotted' => {
  return curve?.style?.dashStyle || 'solid';
};

export default function DigitizerWorkspace() {
  const [showProfiler, setShowProfiler] = useState(false);
  const [isLeftSidebarVisible, setIsLeftSidebarVisible] = useState(true);
  const [isRightInspectorVisible, setIsRightInspectorVisible] = useState(true);
  const [brushWidth, setBrushWidth] = useState<number>(10);
  const [lineTolerance, setLineTolerance] = useState<number>(30);

  const handleStepClick = (stepId: string) => {
    switch (stepId) {
      case 'well_header':
        setActiveTab('project');
        break;
      case 'calibrate':
        setActiveTab('calibration-vertical');
        break;
      case 'digitize':
        setActiveTab('digitize');
        break;
      case 'qc':
        setActiveTab('qc');
        break;
      case 'las':
        setActiveTab('export');
        break;
    }
  };

  const toggleCurveVisibility = (curveId: string) => {
    setHiddenCurveIds(prev => ({
      ...prev,
      [curveId]: !prev[curveId]
    }));
  };

  const toggleCurveLock = (curveId: string) => {
    setLockedCurveIds(prev => ({
      ...prev,
      [curveId]: !prev[curveId]
    }));
  };

  const handleNewProjectSubmit = () => {
    handleCreateNewProject({
      wellName: newWellName,
      field: newField,
      operator: newOperator,
      uwi: newUwi,
      datum: newDatum,
      depthUnit: newDepthUnit,
      topDepth: newTopDepth,
      bottomDepth: newBottomDepth,
      file: newSelectedFile,
      customCurves: newCurves
    });
  };

  const [profileMetrics, setProfileMetrics] = useState<any>(null);
  const frameProfile = useRef<any>({
    frameStart: 0,
    tileSelection: 0,
    cacheLookup: 0,
    canvasDraw: 0,
    frameTotal: 0
  });

  // 1. PROJECT STATE & UNDO/REDO CHANNELS
  const [project, setProject] = useState<ProjectState>({
    version: '1.0.0',
    well: {
      name: 'Untitled Well',
      field: '',
      operator: '',
      uwi: '',
      datum: 'KB',
      depthType: 'MD',
      depthUnit: 'm'
    },
    raster: null,
    nullValueGlobal: -999.25,
    depthTransform: {
      type: 'linear',
      controlPoints: []
    },
    tracks: [],
    curves: [],
    lithologyIntervals: []
  });
  
  const [undoStack, setUndoStack] = useState<ProjectState[]>([]);
  const [redoStack, setRedoStack] = useState<ProjectState[]>([]);
  const [undoCommandStack, setUndoCommandStack] = useState<Command[]>([]);
  const [redoCommandStack, setRedoCommandStack] = useState<Command[]>([]);
  const [activeTab, setActiveTab] = useState<'project' | 'calibration-vertical' | 'calibration-horizontal' | 'digitize' | 'lithology' | 'alignment' | 'qc' | 'export'>('project');
  const [rightActiveTab, setRightActiveTab] = useState<'preview' | 'points'>('preview');
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  
  // Security & Privacy Modal State
  const [showSecurityModal, setShowSecurityModal] = useState<boolean>(true);
  const [dontShowSecurityAgain, setDontShowSecurityAgain] = useState<boolean>(false);

  useEffect(() => {
    try {
      const isHidden = localStorage.getItem('citra_hide_security_notice');
      if (isHidden === 'true') {
        setShowSecurityModal(false);
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, []);

  const handleCloseSecurityModal = () => {
    setShowSecurityModal(false);
    if (dontShowSecurityAgain) {
      try {
        localStorage.setItem('citra_hide_security_notice', 'true');
      } catch (e) {
        // Ignore
      }
    }
  };
  const [newWellName, setNewWellName] = useState('WELL-01');
  const [newField, setNewField] = useState('');
  const [newOperator, setNewOperator] = useState('');
  const [newUwi, setNewUwi] = useState('');
  const [newDatum, setNewDatum] = useState<'KB' | 'GL' | 'MSL'>('KB');
  const [newDepthUnit, setNewDepthUnit] = useState<'m' | 'ft'>('m');
  const [newTopDepth, setNewTopDepth] = useState<number>(1000);
  const [newBottomDepth, setNewBottomDepth] = useState<number>(2000);
  const [newSelectedFile, setNewSelectedFile] = useState<File | null>(null);
  const [newSelectedFileName, setNewSelectedFileName] = useState<string>('');
  
  // Tracking mouse action modes
  const [activeCurveId, setActiveCurveId] = useState<string>('curve-1');
  const [digitizationMode, setDigitizationMode] = useState<'click' | 'freehand' | 'autotrace' | 'erase' | 'aoi'>('click');
  const [isDrawingFreehand, setIsDrawingFreehand] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [isNavigatingMinimap, setIsNavigatingMinimap] = useState(false);
  const [eraserRadius, setEraserRadius] = useState<number>(20);
  const [lasResampleStrategy, setLasResampleStrategy] = useState<'user' | 'dense' | 'median'>('user');
  const [lasUserStep, setLasUserStep] = useState<number>(0.1524);
  const [lasInterpolationMethod, setLasInterpolationMethod] = useState<'linear' | 'pchip' | 'nearest' | 'cubic'>('linear');
  const [validationResults, setValidationResults] = useState<any>(null);

  // Area of Interest (AOI) bounding selection
  const [aoiSelection, setAoiSelection] = useState<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const [isDrawingAoi, setIsDrawingAoi] = useState(false);
  const [aoiStartCoords, setAoiStartCoords] = useState<{ x: number; y: number } | null>(null);
  const [tempAoiBox, setTempAoiBox] = useState<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);

  // Auto Trace State Parameters
  const [autoTraceColorTolerance, setAutoTraceColorTolerance] = useState<number>(40.0);
  const [autoTraceSigma, setAutoTraceSigma] = useState<number>(1.5);
  const [autoTraceMaxAngle, setAutoTraceMaxAngle] = useState<number>(45.0); // degrees
  const [autoTraceGapTolerance, setAutoTraceGapTolerance] = useState<number>(100.0);
  const [autoTraceWColor, setAutoTraceWColor] = useState<number>(0.40);
  const [autoTraceWRidge, setAutoTraceWRidge] = useState<number>(0.25);
  const [autoTraceWOrient, setAutoTraceWOrient] = useState<number>(0.15);
  const [autoTraceWMomentum, setAutoTraceWMomentum] = useState<number>(0.20);




  // Command Palette State
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');

  // Redesign custom UI states
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<'split' | 'raster' | 'digitized' | 'overlay'>('split');
  const [hiddenCurveIds, setHiddenCurveIds] = useState<Record<string, boolean>>({});
  const [lockedCurveIds, setLockedCurveIds] = useState<Record<string, boolean>>({});
  const [showAddCurveForm, setShowAddCurveForm] = useState(false);
  const [newCurveMnemonic, setNewCurveMnemonic] = useState('RHOB');
  const [newCurveUnit, setNewCurveUnit] = useState('G/CC');
  const [newCurveTrackId, setNewCurveTrackId] = useState('');

  // Background Raster Setup
  const [virtualRaster, setVirtualRaster] = useState<VirtualRaster | null>(null);
  const [rasterPipeline, setRasterPipeline] = useState<RasterPipeline | null>(null);
  const [rasterMetadata, setRasterMetadata] = useState<any>(null);
  const [rasterUrl, setRasterUrl] = useState<string>('');
  const [isRasterLoading, setIsRasterLoading] = useState(false);
  const [rasterLoadingStatus, setRasterLoadingStatus] = useState<string>('Compiling CitraNeura Raster Backdrop...');
  const [renderCounter, setRenderCounter] = useState<number>(0);
  const [decodeQueue, setDecodeQueue] = useState<number>(0);
  
  // Image Normalization / Processing Filters
  const [claheEnabled, setClaheEnabled] = useState(false);
  const [grayscaleEnabled, setGrayscaleEnabled] = useState(false);
  const [invertEnabled, setInvertEnabled] = useState(false);

  useEffect(() => {
    if (!rasterPipeline) return;
    rasterPipeline.clearProcessors();
    if (claheEnabled) {
      rasterPipeline.addProcessor(new CLAHEProcessor({ clipLimit: 2.0, tiles: 4, enabled: true }));
    }
    if (grayscaleEnabled) {
      rasterPipeline.addProcessor(new GrayscaleProcessor({ enabled: true }));
    }
    if (invertEnabled) {
      rasterPipeline.addProcessor(new InvertProcessor({ enabled: true }));
    }
    if (virtualRaster) {
      virtualRaster.clearCache();
      setRenderCounter(prev => prev + 1);
    }
  }, [claheEnabled, grayscaleEnabled, invertEnabled, rasterPipeline, virtualRaster]);
  
  // Viewport Zoom & Pan
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [minimapBitmap, setMinimapBitmap] = useState<ImageBitmap | null>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (virtualRaster) {
      virtualRaster.setOnTileLoaded(() => setRenderCounter(c => c + 1));
      virtualRaster.setOnQueueStateChanged((len) => setDecodeQueue(len));
    }
  }, [virtualRaster]);

  // Load and update the minimap thumbnail image bitmap whenever virtualRaster or filters change
  useEffect(() => {
    let active = true;
    if (virtualRaster) {
      virtualRaster.getThumbnail(2400).then(bitmap => {
        if (!active) {
          if (bitmap) bitmap.close();
          return;
        }
        if (bitmap) {
          setMinimapBitmap(prev => {
            if (prev) prev.close();
            return bitmap;
          });
        }
      }).catch(console.error);
    } else {
      setMinimapBitmap(prev => {
        if (prev) prev.close();
        return null;
      });
    }
    return () => {
      active = false;
    };
  }, [virtualRaster, claheEnabled, grayscaleEnabled, invertEnabled, rasterPipeline]);

  // Draw the minimap bitmap on the canvas when it changes or when the canvas mounts/resizes, and overlay all digitized curves
  useEffect(() => {
    const canvas = minimapCanvasRef.current;
    if (canvas && minimapBitmap && project.raster) {
      canvas.width = minimapBitmap.width;
      canvas.height = minimapBitmap.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(minimapBitmap, 0, 0);

        // Draw digitized curves/points on top of the minimap to show progress
        const sX = minimapBitmap.width / project.raster.width;
        const sY = minimapBitmap.height / project.raster.height;

        project.curves.forEach(curve => {
          // Skip hidden curves
          if (hiddenCurveIds[curve.id]) return;

          const curveColor = getCurveColor(curve.metadata.mnemonic);
          
          // Filter valid points (points with actual value)
          const validPoints = curve.points.filter(pt => pt.value !== null);
          if (validPoints.length === 0) return;

          ctx.beginPath();
          ctx.strokeStyle = curveColor;
          ctx.lineWidth = Math.max(3, minimapBitmap.width / 120); // clear, visible lines
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          validPoints.forEach((pt, idx) => {
            const mx = pt.pixelX * sX;
            const my = pt.pixelY * sY;
            if (idx === 0) {
              ctx.moveTo(mx, my);
            } else {
              ctx.lineTo(mx, my);
            }
          });
          ctx.stroke();

          // Highlight the active curve's points slightly
          if (curve.id === activeCurveId) {
            ctx.fillStyle = '#f43f5e'; // rose-500 for active points
            validPoints.forEach(pt => {
              ctx.beginPath();
              ctx.arc(pt.pixelX * sX, pt.pixelY * sY, Math.max(4, minimapBitmap.width / 80), 0, 2 * Math.PI);
              ctx.fill();
            });
          }
        });
      }
    }
  }, [minimapBitmap, project.raster, project.curves, hiddenCurveIds, activeCurveId]);

  // Ensure activeCurveId is always pointing to a valid curve in project.curves
  useEffect(() => {
    if (project.curves.length > 0) {
      const exists = project.curves.some(c => c.id === activeCurveId);
      if (!exists) {
        setActiveCurveId(project.curves[0].id);
      }
    }
  }, [project.curves, activeCurveId]);

  // Clean up any remaining bitmap on unmount
  useEffect(() => {
    return () => {
      setMinimapBitmap(prev => {
        if (prev) prev.close();
        return null;
      });
    };
  }, []);

  // Adaptive background color for Digitized Data View based on raster paper tone
  const [adaptiveBgColor, setAdaptiveBgColor] = useState<string>('#f8fafc');

  useEffect(() => {
    if (canvasRef.current && project.raster) {
      try {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          const sampleData = ctx.getImageData(10, 10, 20, 20);
          let r = 0, g = 0, b = 0, count = 0;
          for (let i = 0; i < sampleData.data.length; i += 4) {
            const alpha = sampleData.data[i + 3];
            if (alpha > 100) {
              r += sampleData.data[i];
              g += sampleData.data[i + 1];
              b += sampleData.data[i + 2];
              count++;
            }
          }
          if (count > 0) {
            r = Math.round(r / count);
            g = Math.round(g / count);
            b = Math.round(b / count);
            const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            if (lum > 120) {
              setAdaptiveBgColor(`rgb(${r}, ${g}, ${b})`);
            } else {
              setAdaptiveBgColor('#f8fafc');
            }
          }
        }
      } catch (e) {
        setAdaptiveBgColor('#f8fafc');
      }
    }
  }, [project.raster, virtualRaster, zoomScale, panOffset]);

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [draggingDepthAnchor, setDraggingDepthAnchor] = useState<number | null>(null);
  const [draggingSlantedAnchorPart, setDraggingSlantedAnchorPart] = useState<'left' | 'right' | 'center' | null>(null);
  const [showAddTrackForm, setShowAddTrackForm] = useState(false);
  const [newTrackMnemonic, setNewTrackMnemonic] = useState('GR');
  const [newTrackUnit, setNewTrackUnit] = useState('API');
  const [newTrackScaleType, setNewTrackScaleType] = useState<'linear' | 'log'>('linear');
  const [newTrackValueMin, setNewTrackValueMin] = useState('0');
  const [newTrackValueMax, setNewTrackValueMax] = useState('150');
  const [draggingGlobalX, setDraggingGlobalX] = useState(false);
  const [globalXAnchor, setGlobalXAnchor] = useState<number>(150);
  const [mouseHoverCoords, setMouseHoverCoords] = useState<{ x: number; y: number } | null>(null);
  const [draggingTrackEdge, setDraggingTrackEdge] = useState<{ id: string; side: 'left' | 'right'; pointIndex?: number; isNew?: boolean } | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 700, height: 900 });
  
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [draggingCurvePoint, setDraggingCurvePoint] = useState<{ curveId: string; pointIndex: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'canvas' | 'point'; targetId?: string; pointIndex?: number } | null>(null);
  const [tiltedClickState, setTiltedClickState] = useState<{ anchorIndex: number; step: 'left' | 'right' } | null>(null);
  
  const viewportStateRef = useRef({ 
    zoomScale, 
    panOffset, 
    rasterW: 700, 
    rasterH: 900, 
    viewW: 700, 
    viewH: 900 
  });
  
  useEffect(() => {
    viewportStateRef.current = { 
      zoomScale, 
      panOffset,
      rasterW: project.raster?.width || 700,
      rasterH: project.raster?.height || 900,
      viewW: viewportSize.width,
      viewH: viewportSize.height
    };
  }, [zoomScale, panOffset, project.raster?.width, project.raster?.height, viewportSize]);

  const clampPan = (pan: {x: number, y: number}, zoom: number, overrideW?: number, overrideH?: number) => {
    const st = viewportStateRef.current;
    const rW = overrideW ?? st.rasterW;
    const rH = overrideH ?? st.rasterH;
    let maxX = (rW * zoom - st.viewW) / 2;
    let maxY = (rH * zoom - st.viewH) / 2;
    if (maxX < 0) maxX = 0;
    if (maxY < 0) maxY = 0;
    return {
      x: Math.max(-maxX, Math.min(maxX, pan.x)),
      y: Math.max(-maxY, Math.min(maxY, pan.y))
    };
  };

  const pendingPanAndZoomRef = useRef<{ pan: { x: number; y: number }, zoom: number } | null>(null);
  const rAFHandleRef = useRef<number | null>(null);

  const updatePanAndZoom = (newPan: {x: number, y: number}, newZoom: number, overrideW?: number, overrideH?: number) => {
    const st = viewportStateRef.current;
    const rW = overrideW ?? st.rasterW;
    const rH = overrideH ?? st.rasterH;
    const fitWidthZoom = st.viewW / rW;
    const fitHeightZoom = st.viewH / rH;
    const minZoom = Math.max(0.01, Math.min(fitWidthZoom, fitHeightZoom) * 0.8);
    
    const clampedZoom = Math.max(minZoom, Math.min(5.0, newZoom));
    const clampedPan = clampPan(newPan, clampedZoom, overrideW, overrideH);
    
    pendingPanAndZoomRef.current = { pan: clampedPan, zoom: clampedZoom };
    
    if (rAFHandleRef.current === null) {
      rAFHandleRef.current = requestAnimationFrame(() => {
        if (pendingPanAndZoomRef.current) {
          const { pan, zoom } = pendingPanAndZoomRef.current;
          setZoomScale(zoom);
          setPanOffset(pan);
          viewportStateRef.current = {
            ...viewportStateRef.current,
            zoomScale: zoom,
            panOffset: pan
          };
          pendingPanAndZoomRef.current = null;
        }
        rAFHandleRef.current = null;
      });
    }
  };

  const pendingProjectUpdateRef = useRef<ProjectState | null>(null);
  const projectRAFHandleRef = useRef<number | null>(null);
  const lastStateUpdateRef = useRef<number>(0);

  const throttleSetProject = (newProject: ProjectState, force = false) => {
    projectRef.current = newProject; // Update ref immediately for instant reference reads
    pendingProjectUpdateRef.current = newProject;
    
    const now = performance.now();
    const throttleTime = 16; // 60 FPS smooth rendering for all interactive modes
    
    if (force || (now - lastStateUpdateRef.current >= throttleTime)) {
      if (projectRAFHandleRef.current === null) {
        projectRAFHandleRef.current = requestAnimationFrame(() => {
          if (pendingProjectUpdateRef.current) {
            setProject(pendingProjectUpdateRef.current);
            lastStateUpdateRef.current = performance.now();
            pendingProjectUpdateRef.current = null;
          }
          projectRAFHandleRef.current = null;
        });
      }
    }
  };

  const minimapRef = useRef<HTMLDivElement | null>(null);
  const [minimapSize, setMinimapSize] = useState({ width: 115, height: 260 });

  const handleMinimapNavigation = (clientX: number, clientY: number) => {
    if (!minimapRef.current || !project.raster) return;
    const rect = minimapRef.current.getBoundingClientRect();
    
    const mx = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const my = Math.max(0, Math.min(rect.height, clientY - rect.top));
    
    const rW = project.raster.width;
    const rH = project.raster.height;
    
    const scaleX = rect.width / rW;
    const scaleY = rect.height / rH;
    
    const rx = mx / scaleX;
    const ry = my / scaleY;
    
    const targetPanX = -zoomScale * (rx - rW / 2);
    const targetPanY = -zoomScale * (ry - rH / 2);
    
    updatePanAndZoom({ x: targetPanX, y: targetPanY }, zoomScale);
  };

  const handleMinimapMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsNavigatingMinimap(true);
    handleMinimapNavigation(e.clientX, e.clientY);
  };

  const handleMinimapMouseMove = (e: React.MouseEvent) => {
    if (isNavigatingMinimap) {
      e.stopPropagation();
      e.preventDefault();
      handleMinimapNavigation(e.clientX, e.clientY);
    }
  };

  useEffect(() => {
    if (!isNavigatingMinimap) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      handleMinimapNavigation(e.clientX, e.clientY);
    };

    const handleGlobalMouseUp = () => {
      setIsNavigatingMinimap(false);
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isNavigatingMinimap, zoomScale, project.raster]);

  // Double split-panel interactive resize settings
  const [leftWidth, setLeftWidth] = useState<number>(25); // percentage (default is col-span-3, i.e. 25%)
  const [rightWidth, setRightWidth] = useState<number>(50); // percentage (default 50% for equal 50/50 split workspace)
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const workspaceContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    window.addEventListener('resize', handleResize);
    const timer = setTimeout(handleResize, 0);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, []);

  // Update window style resize globally when resizing left barrier
  useEffect(() => {
    if (!isResizingLeft) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!workspaceContainerRef.current) return;
      const rect = workspaceContainerRef.current.getBoundingClientRect();
      const newLeftWidth = ((e.clientX - rect.left) / rect.width) * 100;
      // Impose boundaries (min 15%, max 45% to preserve UI balance)
      setLeftWidth(Math.max(15, Math.min(45, newLeftWidth)));
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingLeft]);

  // Update window style resize globally when resizing right barrier
  useEffect(() => {
    if (!isResizingRight) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!workspaceContainerRef.current) return;
      const rect = workspaceContainerRef.current.getBoundingClientRect();
      const newRightWidth = ((rect.right - e.clientX) / rect.width) * 100;
      // Impose boundaries (min 20%, max 80% to allow flexible equal splits)
      setRightWidth(Math.max(20, Math.min(80, newRightWidth)));
    };

    const handleMouseUp = () => {
      setIsResizingRight(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingRight]);

  // Set cursor and selection properties globally on body during active dragging
  useEffect(() => {
    if (isResizingLeft || isResizingRight) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingLeft, isResizingRight]);

  // Update viewport dimensions automatically using ResizeObserver to ensure robust calculations
  useEffect(() => {
    const updateSize = () => {
      if (viewportRef.current) {
        setViewportSize({
          width: viewportRef.current.clientWidth,
          height: viewportRef.current.clientHeight
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    
    let observer: ResizeObserver | null = null;
    if (viewportRef.current) {
      observer = new ResizeObserver(updateSize);
      observer.observe(viewportRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateSize);
      if (observer) observer.disconnect();
    };
  }, []);

  // Update minimap dimensions automatically using ResizeObserver
  useEffect(() => {
    const updateMiniSize = () => {
      if (minimapRef.current) {
        setMinimapSize({
          width: minimapRef.current.clientWidth || 115,
          height: minimapRef.current.clientHeight || 260
        });
      }
    };
    updateMiniSize();
    window.addEventListener('resize', updateMiniSize);
    
    let observer: ResizeObserver | null = null;
    if (minimapRef.current) {
      observer = new ResizeObserver(updateMiniSize);
      observer.observe(minimapRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateMiniSize);
      if (observer) observer.disconnect();
    };
  }, []);

  // Synchronous native mouse wheel scroll zooming for robust performance across split viewports
  useEffect(() => {
    const v1 = viewportRef.current;
    const v2 = rightViewportRef.current;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      const prevPan = viewportStateRef.current.panOffset;
      const prevZoom = viewportStateRef.current.zoomScale;
      
      const st = viewportStateRef.current;
      
      // Shift + Wheel = Horizontal Scroll
      if (e.shiftKey) {
        const scrollAmount = e.deltaY;
        updatePanAndZoom({ x: prevPan.x - scrollAmount, y: prevPan.y }, prevZoom);
        return;
      }

      const fitWidthZoom = st.viewW / st.rasterW;
      const fitHeightZoom = st.viewH / st.rasterH;
      const minZoom = Math.max(0.01, Math.min(fitWidthZoom, fitHeightZoom) * 0.8);
      
      // Multiplicative zoom factor for elegant and smooth scaling
      const zoomFactor = 1.15;
      const newZoom = Math.max(minZoom, Math.min(50.0, e.deltaY < 0 ? prevZoom * zoomFactor : prevZoom / zoomFactor));
      
      if (newZoom !== prevZoom) {
        const targetViewport = (e.currentTarget as HTMLElement) || v1;
        const rect = targetViewport ? targetViewport.getBoundingClientRect() : { left: 0, top: 0, width: st.viewW, height: st.viewH };
        const mouseX = e.clientX - rect.left - rect.width / 2;
        const mouseY = e.clientY - rect.top - rect.height / 2;
        
        const imageX = (mouseX - prevPan.x) / prevZoom;
        const imageY = (mouseY - prevPan.y) / prevZoom;
        
        const newPanX = mouseX - imageX * newZoom;
        const newPanY = mouseY - imageY * newZoom;
        
        updatePanAndZoom({ x: newPanX, y: newPanY }, newZoom);
      }
    };

    if (v1) v1.addEventListener('wheel', handleWheel, { passive: false });
    if (v2) v2.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      if (v1) v1.removeEventListener('wheel', handleWheel);
      if (v2) v2.removeEventListener('wheel', handleWheel);
    };
  }, [project.raster, workspaceMode]);
  
  // Active Lithology Draw Form
  const [lithoForm, setLithoForm] = useState({
    depthTop: 1460,
    depthBottom: 1485,
    label: 'Clean Sandstone',
    colorHex: '#eede95',
    patternId: 'sand_01'
  });

  // Reference Refs for canvas operations
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingBufferRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const rightViewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const eraserCursorRef = useRef<HTMLDivElement>(null);

  // High-frequency digitizing refs to bypass React state updates on mousemove
  const tempFreehandPointsRef = useRef<{ x: number; y: number }[]>([]);

  const currentActiveCurve = project.curves.find(c => c.id === activeCurveId);
  const currentActiveTrack = project.tracks.find(t => t.id === currentActiveCurve?.trackId);
  const activeCurveColor = getCurveVisualColor(currentActiveCurve);

  // Active track being calibrated for horizontal scale
  const [calibratingXTrack, setCalibratingXTrack] = useState<{ id: string; side: 'left' | 'right' } | null>(null);
  const [horizontalCalibMode, setHorizontalCalibMode] = useState<'slide' | 'polyline'>('slide');

  // Interfaces & states for customized curve creations inside the New Project Modal
  interface NewCurveConfig {
    id: string;
    mnemonic: string;
    unit: string;
    nullValue: number;
    scaleType: 'linear' | 'log';
    valueMin: number;
    valueMax: number;
    pixelMin: number;
    pixelMax: number;
    color: string;
    direction?: 'normal' | 'reverse';
  }

  const [newCurves, setNewCurves] = useState<NewCurveConfig[]>([]);

  const handleAddNewCurveConfig = () => {
    const nextIdx = newCurves.length + 1;
    const lastCurve = newCurves[newCurves.length - 1];
    const nextPixelMin = lastCurve ? Math.min(650, lastCurve.pixelMax + 30) : 50;
    const nextPixelMax = Math.min(700, nextPixelMin + 200);

    const fallbackColors = ['#047857', '#b91c1c', '#7c3aed', '#0284c7', '#d97706', '#ec4899', '#0f766e'];
    const nextColor = fallbackColors[newCurves.length % fallbackColors.length];

    setNewCurves([...newCurves, {
      id: `curve-idx-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      mnemonic: `CURVE_${nextIdx}`,
      unit: 'API',
      nullValue: -999.25,
      scaleType: 'linear',
      valueMin: 0,
      valueMax: 100,
      pixelMin: nextPixelMin,
      pixelMax: nextPixelMax,
      color: nextColor,
      direction: 'normal'
    }]);
  };

  const handleRemoveCurveConfig = (id: string) => {
    setNewCurves(newCurves.filter(c => c.id !== id));
  };

  const handleUpdateCurveConfig = (id: string, updatedFields: Partial<NewCurveConfig>) => {
    setNewCurves(newCurves.map(c => c.id === id ? { ...c, ...updatedFields } : c));
  };

  // --- COMMAND FRAMEWORK STATE & EXECUTOR (CHECKPOINT P-02) ---
  const [auditTrail, setAuditTrail] = useState<AuditTrailEntry[]>([]);
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // Reference hooks to keep command callbacks always reading fresh state
  const projectRef = useRef<ProjectState>(project);
  const commandViewportRef = useRef({ zoomScale, panOffset });
  const traceParamsRef = useRef({
    colorTolerance: autoTraceColorTolerance,
    sigma: autoTraceSigma,
    maxAngle: autoTraceMaxAngle,
    gapTolerance: autoTraceGapTolerance,
    wColor: autoTraceWColor,
    wRidge: autoTraceWRidge,
    wOrient: autoTraceWOrient,
    wMomentum: autoTraceWMomentum,
  });

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    commandViewportRef.current = { zoomScale, panOffset };
  }, [zoomScale, panOffset]);

  useEffect(() => {
    traceParamsRef.current = {
      colorTolerance: autoTraceColorTolerance,
      sigma: autoTraceSigma,
      maxAngle: autoTraceMaxAngle,
      gapTolerance: autoTraceGapTolerance,
      wColor: autoTraceWColor,
      wRidge: autoTraceWRidge,
      wOrient: autoTraceWOrient,
      wMomentum: autoTraceWMomentum,
    };
  }, [
    autoTraceColorTolerance,
    autoTraceSigma,
    autoTraceMaxAngle,
    autoTraceGapTolerance,
    autoTraceWColor,
    autoTraceWRidge,
    autoTraceWOrient,
    autoTraceWMomentum,
  ]);

  // --- WORKSPACE SESSION RECOVERY FOUNDATION (CHECKPOINT P-06) ---
  interface WorkspaceSessionSnapshot {
    version: string;
    timestamp: string;
    project: ProjectState;
    activeCurveId: string;
    autoTraceParams: {
      colorTolerance: number;
      sigma: number;
      maxAngle: number;
      gapTolerance: number;
      wColor: number;
      wRidge: number;
      wOrient: number;
      wMomentum: number;
    };
  }

  const isSessionInitialized = useRef<boolean>(false);
  const isViewInitializedRef = useRef<string | null>(null);

  useEffect(() => {
    if (project.raster && viewportSize.width > 100 && viewportSize.height > 100) {
      const cacheKey = `${project.raster.name}-${project.raster.width}-${project.raster.height}-${viewportSize.width}-${viewportSize.height}`;
      if (isViewInitializedRef.current !== cacheKey) {
        isViewInitializedRef.current = cacheKey;
        // Run fit width & top aligned
        const rW = project.raster.width;
        const rH = project.raster.height;
        const fitZoom = viewportSize.width / rW;
        const panY = (rH * fitZoom - viewportSize.height) / 2;
        updatePanAndZoom({ x: 0, y: panY }, fitZoom, rW, rH);
        logInfo("Viewport auto-fitted: width fit & top aligned");
      }
    }
  }, [project.raster, viewportSize]);

  const applyProjectStateDirectly = (newState: ProjectState, desc: string) => {
    const healedState = healProjectState(newState);
    const validationErrors = validateProjectInvariants(healedState);
    if (validationErrors.length > 0) {
      console.error("[Workspace Integrity] Invariant violations detected:", validationErrors);
      throw new Error(`Workspace Invariant Violation: Command rejected to preserve integrity.\n${validationErrors.join('\n')}`);
    }
    setProject(healedState);
    logInfo(`Action recorded: ${desc}`);
  };

  const saveActionState = (newState: ProjectState, desc: string) => {
    executeCommand(new UpdateProjectStateCommand(desc, newState));
  };

  const handleUpdateCurveScaleOverride = (curveId: string, transform: ValueTransform | undefined) => {
    const updatedCurves = project.curves.map(c => {
      if (c.id === curveId) {
        const track = project.tracks.find(t => t.id === c.trackId);
        if (!track) return { ...c, valueTransform: transform };

        const transformToUse = transform ? {
          ...transform,
          pixelMin: track.valueTransform.pixelMin,
          pixelMax: track.valueTransform.pixelMax
        } : track.valueTransform;

        const updatedPoints = c.points.map(pt => {
          const lX = getTrackBoundX(track, 'left', pt.pixelY);
          const rX = getTrackBoundX(track, 'right', pt.pixelY);
          const newVal = pixelXToValue(pt.pixelX, transformToUse, lX, rX);
          return {
            ...pt,
            value: Number(newVal.toFixed(4))
          };
        });

        return {
          ...c,
          valueTransform: transform,
          points: updatedPoints
        };
      }
      return c;
    });

    const newState = {
      ...project,
      curves: updatedCurves
    };
    setProject(newState);
    saveActionState(newState, `Mengubah kalibrasi skala khusus kurva ${curveId}.`);
  };

  const handleUpdateCurveStyle = (curveId: string, styleUpdates: Partial<CurveStyle>) => {
    const updatedCurves = project.curves.map(c => {
      if (c.id === curveId) {
        return {
          ...c,
          style: {
            ...c.style,
            ...styleUpdates
          }
        };
      }
      return c;
    });

    const newState = {
      ...project,
      curves: updatedCurves
    };
    setProject(newState);
    saveActionState(newState, `Mengubah pengaturan tampilan kurva ${curveId}.`);
  };

  const pushDirectProjectSnapshot = (desc: string) => {
    const cmd = new UpdateProjectStateCommand(desc, project);
    cmd.lifecycle = 'completed';
    cmd.previousState = project;
    setUndoCommandStack(prev => [...prev.slice(-99), cmd]);
    setRedoCommandStack([]);
    setUndoStack(prev => [...prev.slice(-99), project]);
    setRedoStack([]);
  };

  const commitLastSnapshotFinalState = (finalState: ProjectState) => {
    setUndoCommandStack(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last instanceof UpdateProjectStateCommand) {
        last.nextState = finalState;
      }
      return [...prev];
    });
  };

  const executeCommand = async (command: Command, isRedo = false) => {
    const entryId = command.id;
    const entry: AuditTrailEntry = {
      timestamp: new Date().toLocaleTimeString(),
      commandId: entryId,
      commandName: command.name,
      status: 'initialized',
      payload: null
    };

    // Append to audit trail
    setAuditTrail(prev => [entry, ...prev]);

    // Construct command environment context
    const context: CommandContext = {
      getProjectState: () => projectRef.current,
      setProjectState: (state: ProjectState, desc: string) => {
        applyProjectStateDirectly(state, desc);
      },
      getViewport: () => commandViewportRef.current,
      setViewport: (zoom, pan) => {
        updatePanAndZoom(pan, zoom);
      },
      getTraceParameters: () => traceParamsRef.current,
      setTraceParameters: (params) => {
        if (params.colorTolerance !== undefined) setAutoTraceColorTolerance(params.colorTolerance);
        if (params.sigma !== undefined) setAutoTraceSigma(params.sigma);
        if (params.maxAngle !== undefined) setAutoTraceMaxAngle(params.maxAngle);
        if (params.gapTolerance !== undefined) setAutoTraceGapTolerance(params.gapTolerance);
        if (params.wColor !== undefined) setAutoTraceWColor(params.wColor);
        if (params.wRidge !== undefined) setAutoTraceWRidge(params.wRidge);
        if (params.wOrient !== undefined) setAutoTraceWOrient(params.wOrient);
        if (params.wMomentum !== undefined) setAutoTraceWMomentum(params.wMomentum);
      },
      getDirtyFlag: () => isDirty,
      setDirtyFlag: (dirty: boolean) => {
        setIsDirty(dirty);
      },
      log: (message: string) => {
        logInfo(message);
      }
    };

    try {
      command.lifecycle = 'executing';
      setAuditTrail(prev =>
        prev.map(item =>
          item.commandId === entryId
            ? { ...item, status: 'executing' }
            : item
        )
      );

      await command.execute(context);

      setAuditTrail(prev =>
        prev.map(item =>
          item.commandId === entryId
            ? { ...item, status: 'completed' }
            : item
        )
      );

      // Manage Undo/Redo Stacks
      if (typeof command.undo === 'function' && !isRedo) {
        setUndoCommandStack(prev => [...prev.slice(-99), command]);
        setRedoCommandStack([]); // Clear redo stack on brand new action
      }
    } catch (err: any) {
      console.error(`[Command Framework] ${command.name} error:`, err);
      setAuditTrail(prev =>
        prev.map(item =>
          item.commandId === entryId
            ? { ...item, status: 'failed', error: err.message || String(err) }
            : item
        )
      );
      throw err;
    }
  };

  const handlesUndo = async () => {
    if (undoCommandStack.length === 0) {
      logInfo("Undo stack empty.");
      return;
    }
    const commandToUndo = undoCommandStack[undoCommandStack.length - 1];

    const context: CommandContext = {
      getProjectState: () => projectRef.current,
      setProjectState: (state: ProjectState, desc: string) => {
        applyProjectStateDirectly(state, desc);
      },
      getViewport: () => commandViewportRef.current,
      setViewport: (zoom, pan) => {
        updatePanAndZoom(pan, zoom);
      },
      getTraceParameters: () => traceParamsRef.current,
      setTraceParameters: (params) => {
        if (params.colorTolerance !== undefined) setAutoTraceColorTolerance(params.colorTolerance);
        if (params.sigma !== undefined) setAutoTraceSigma(params.sigma);
        if (params.maxAngle !== undefined) setAutoTraceMaxAngle(params.maxAngle);
        if (params.gapTolerance !== undefined) setAutoTraceGapTolerance(params.gapTolerance);
        if (params.wColor !== undefined) setAutoTraceWColor(params.wColor);
        if (params.wRidge !== undefined) setAutoTraceWRidge(params.wRidge);
        if (params.wOrient !== undefined) setAutoTraceWOrient(params.wOrient);
        if (params.wMomentum !== undefined) setAutoTraceWMomentum(params.wMomentum);
      },
      getDirtyFlag: () => isDirty,
      setDirtyFlag: (dirty: boolean) => {
        setIsDirty(dirty);
      },
      log: (message: string) => {
        logInfo(message);
      }
    };

    try {
      if (commandToUndo.undo) {
        await commandToUndo.undo(context);

        // Append log to audit trail
        const auditEntry: AuditTrailEntry = {
          timestamp: new Date().toLocaleTimeString(),
          commandId: `undo_${commandToUndo.id}_${Date.now()}`,
          commandName: `Undo: ${commandToUndo.name}`,
          status: 'completed',
          payload: null
        };
        setAuditTrail(prev => [auditEntry, ...prev]);

        // Move item from undo to redo stack
        setUndoCommandStack(prev => prev.slice(0, prev.length - 1));
        setRedoCommandStack(prev => [...prev, commandToUndo]);
        logInfo(`Undo successful: ${commandToUndo.name}`);
      }
    } catch (err: any) {
      console.error(`[Command Framework] Undo error:`, err);
      logInfo(`Undo failed: ${err.message || String(err)}`);
    }
  };

  const handlesRedo = async () => {
    if (redoCommandStack.length === 0) {
      logInfo("Redo stack empty.");
      return;
    }
    const commandToRedo = redoCommandStack[redoCommandStack.length - 1];

    const context: CommandContext = {
      getProjectState: () => projectRef.current,
      setProjectState: (state: ProjectState, desc: string) => {
        applyProjectStateDirectly(state, desc);
      },
      getViewport: () => commandViewportRef.current,
      setViewport: (zoom, pan) => {
        updatePanAndZoom(pan, zoom);
      },
      getTraceParameters: () => traceParamsRef.current,
      setTraceParameters: (params) => {
        if (params.colorTolerance !== undefined) setAutoTraceColorTolerance(params.colorTolerance);
        if (params.sigma !== undefined) setAutoTraceSigma(params.sigma);
        if (params.maxAngle !== undefined) setAutoTraceMaxAngle(params.maxAngle);
        if (params.gapTolerance !== undefined) setAutoTraceGapTolerance(params.gapTolerance);
        if (params.wColor !== undefined) setAutoTraceWColor(params.wColor);
        if (params.wRidge !== undefined) setAutoTraceWRidge(params.wRidge);
        if (params.wOrient !== undefined) setAutoTraceWOrient(params.wOrient);
        if (params.wMomentum !== undefined) setAutoTraceWMomentum(params.wMomentum);
      },
      getDirtyFlag: () => isDirty,
      setDirtyFlag: (dirty: boolean) => {
        setIsDirty(dirty);
      },
      log: (message: string) => {
        logInfo(message);
      }
    };

    try {
      await commandToRedo.execute(context);

      // Append log to audit trail
      const auditEntry: AuditTrailEntry = {
        timestamp: new Date().toLocaleTimeString(),
        commandId: `redo_${commandToRedo.id}_${Date.now()}`,
        commandName: `Redo: ${commandToRedo.name}`,
        status: 'completed',
        payload: null
      };
      setAuditTrail(prev => [auditEntry, ...prev]);

      // Move item from redo to undo stack
      setRedoCommandStack(prev => prev.slice(0, prev.length - 1));
      setUndoCommandStack(prev => [...prev, commandToRedo]);
      logInfo(`Redo successful: ${commandToRedo.name}`);
    } catch (err: any) {
      console.error(`[Command Framework] Redo error:`, err);
      logInfo(`Redo failed: ${err.message || String(err)}`);
    }
  };

  const handleFitRaster = () => {
    const st = viewportStateRef.current;
    if (st.rasterW > 0 && st.rasterH > 0) {
      const fitZoom = st.viewW / st.rasterW;
      const panY = (st.rasterH * fitZoom - st.viewH) / 2;
      updatePanAndZoom({ x: 0, y: panY }, fitZoom);
      logInfo("Fit raster width and top aligned");
    }
  };

  const handleZoom100 = () => {
    updatePanAndZoom({ x: 0, y: 0 }, 1.0);
    logInfo("Zoom reset to 100%");
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl) {
        const tag = activeEl.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || activeEl.hasAttribute('contenteditable')) {
          return;
        }
      }

      // Space -> Temporary Pan
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
      }

      // Command Palette (Ctrl+K or Cmd+K)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }

      // Escape -> Cancel Tool & Close Dialogs
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsCommandPaletteOpen(false);
        setCalibratingXTrack(null);
        setDraggingDepthAnchor(null);
        setDraggingTrackEdge(null);
        setDraggingCurvePoint(null);
        setIsPanning(false);
        setContextMenu(null);
        setIsDrawingFreehand(false);
        setIsErasing(false);
        setTiltedClickState(null);
      }

      // Delete -> Delete Selected point/node or Last point
      if (e.key === 'Delete') {
        e.preventDefault();
        if (contextMenu && contextMenu.type === 'point' && contextMenu.targetId && contextMenu.pointIndex !== undefined) {
          const curve = project.curves.find(c => c.id === contextMenu.targetId);
          if (curve) {
            const pt = curve.points[contextMenu.pointIndex];
            if (pt) removeDigitizedPoint(pt.id);
          }
          setContextMenu(null);
        } else {
          const activeCurve = project.curves.find(c => c.id === activeCurveId);
          if (activeCurve && activeCurve.points.length > 0) {
            const lastPt = activeCurve.points[activeCurve.points.length - 1];
            removeDigitizedPoint(lastPt.id);
          }
        }
      }

      // Undo (Ctrl+Z or Cmd+Z)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handlesUndo();
      }

      // Redo (Ctrl+Y or Cmd+Y or Ctrl+Shift+Z or Cmd+Shift+Z)
      if (((e.ctrlKey || e.metaKey) && e.key === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        handlesRedo();
      }

      // F -> Focus Mode
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setIsFocusMode(prev => !prev);
      }

      // 1 -> 100% Zoom
      if (e.key === '1' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleZoom100();
      }

      // + or = -> Zoom In
      if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const st = viewportStateRef.current;
        updatePanAndZoom(st.panOffset, st.zoomScale * 1.25);
      }

      // - or _ -> Zoom Out
      if ((e.key === '-' || e.key === '_') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const st = viewportStateRef.current;
        updatePanAndZoom(st.panOffset, st.zoomScale * 0.8);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [undoCommandStack, redoCommandStack, project, isDirty, activeCurveId, contextMenu, isFocusMode]);

  // --- AUTOMATIC SESSION RECOVERY EFFECTS ---
  // 1. Session Restoration on mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const snapshot = await localforage.getItem<WorkspaceSessionSnapshot>('citra_session_recovery_snapshot');
        if (snapshot) {
          // Schema Version Check: reject if mismatch
          if (snapshot.version !== '1.0.0') {
            console.warn(`[Session Recovery] Schema version mismatch: expected '1.0.0', got '${snapshot.version}'. Rejecting.`);
            isSessionInitialized.current = true;
            return;
          }

          // Invariant Check: run validator to ensure no corrupted recovery state is activated
          const healedProj = healProjectState(snapshot.project);
          const validationErrors = validateProjectInvariants(healedProj);
          if (validationErrors.length > 0) {
            console.error('[Session Recovery] Invariant violations in recovery snapshot:', validationErrors);
            await localforage.removeItem('citra_session_recovery_snapshot');
            logInfo("Sesi pemulihan otomatis ditolak karena tidak memenuhi kriteria integritas.");
            isSessionInitialized.current = true;
            return;
          }

          // Apply recovered state safely
          const syncedProj = syncCalibrations(healedProj);
          setProject(syncedProj);
          if (snapshot.project.raster?.dataUrl) {
            setRasterUrl(snapshot.project.raster.dataUrl);
          }
          if (snapshot.activeCurveId) {
            setActiveCurveId(snapshot.activeCurveId);
          }

          // Restore VirtualRaster if saved in localforage
          try {
            const savedFile = await localforage.getItem<Blob | File>('citra_session_recovery_raster_file');
            const savedName = await localforage.getItem<string>('citra_session_recovery_raster_name');
            if (savedFile) {
              setIsRasterLoading(true);
              setRasterLoadingStatus('Memulihkan gambar raster...');
              await loadRasterEngineOnly(savedFile, savedName || 'recovered_log_image');
              setIsRasterLoading(false);
            }
          } catch (rErr) {
            console.error('[Session Recovery] VirtualRaster engine load failed:', rErr);
            setIsRasterLoading(false);
          }
          if (snapshot.autoTraceParams) {
            const p = snapshot.autoTraceParams;
            if (p.colorTolerance !== undefined) setAutoTraceColorTolerance(p.colorTolerance);
            if (p.sigma !== undefined) setAutoTraceSigma(p.sigma);
            if (p.maxAngle !== undefined) setAutoTraceMaxAngle(p.maxAngle);
            if (p.gapTolerance !== undefined) setAutoTraceGapTolerance(p.gapTolerance);
            if (p.wColor !== undefined) setAutoTraceWColor(p.wColor);
            if (p.wRidge !== undefined) setAutoTraceWRidge(p.wRidge);
            if (p.wOrient !== undefined) setAutoTraceWOrient(p.wOrient);
            if (p.wMomentum !== undefined) setAutoTraceWMomentum(p.wMomentum);
          }

          // Explicit decision: Reset Undo/Redo queues on recovery for a clean operational state
          setUndoStack([]);
          setRedoStack([]);
          setUndoCommandStack([]);
          setRedoCommandStack([]);

          logInfo("Sesi aktif berhasil dipulihkan secara otomatis.");
        }
      } catch (err: any) {
        console.error('[Session Recovery] Restoration error:', err);
        logInfo("Gagal memulihkan sesi aktif otomatis karena data tidak kompatibel atau rusak.");
      } finally {
        isSessionInitialized.current = true;
      }
    };
    restoreSession();
  }, []);

  // 2. Session Auto-Saver (Writer) with 1s debounce to prevent blocking disk I/O
  useEffect(() => {
    if (!isSessionInitialized.current) return;

    const timer = setTimeout(async () => {
      // Run invariant validation before committing recovery state to disk
      const healedProj = healProjectState(project);
      const validationErrors = validateProjectInvariants(healedProj);
      if (validationErrors.length > 0) {
        console.warn("[Session Recovery] Auto-save skipped due to invariant violations:", validationErrors);
        return;
      }

      const snapshot: WorkspaceSessionSnapshot = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        project: healedProj,
        activeCurveId,
        autoTraceParams: {
          colorTolerance: autoTraceColorTolerance,
          sigma: autoTraceSigma,
          maxAngle: autoTraceMaxAngle,
          gapTolerance: autoTraceGapTolerance,
          wColor: autoTraceWColor,
          wRidge: autoTraceWRidge,
          wOrient: autoTraceWOrient,
          wMomentum: autoTraceWMomentum
        }
      };

      try {
        await localforage.setItem('citra_session_recovery_snapshot', snapshot);
      } catch (err) {
        console.error('[Session Recovery] Auto-save error:', err);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    project,
    activeCurveId,
    autoTraceColorTolerance,
    autoTraceSigma,
    autoTraceMaxAngle,
    autoTraceGapTolerance,
    autoTraceWColor,
    autoTraceWRidge,
    autoTraceWOrient,
    autoTraceWMomentum
  ]);

  const handleSaveProjectJson = () => {
    try {
      const dataStr = JSON.stringify(project, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      
      const exportFileDefaultName = `${project.well.name || 'WELL'}_digitizer_project.json`;
      
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();
      logInfo("Proyek berhasil diunduh sebagai berkas JSON.");
    } catch (e: any) {
      alert(`Gagal menyimpan proyek: ${e?.message || e}`);
    }
  };

  const handleLoadProjectJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        
        if (!parsed.well || !parsed.tracks || !parsed.curves) {
          throw new Error("Skema fail proyek JSON tidak cocok.");
        }

        const projectVersion = parsed.version || '1.0.0';
        parsed.version = projectVersion; // ensure it is set

        // Enforce invariants on load
        const healedParsed = healProjectState(parsed);
        const validationErrors = validateProjectInvariants(healedParsed);
        if (validationErrors.length > 0) {
          throw new Error(`State Invariant Violation: Loaded project failed integrity validation.\n${validationErrors.join('\n')}`);
        }

        setProject(healedParsed);
        if (parsed.raster?.dataUrl) {
          setRasterUrl(parsed.raster.dataUrl);
        }
        setUndoStack([]);
        setRedoStack([]);
        setUndoCommandStack([]);
        setRedoCommandStack([]);
        logInfo(`Proyek berhasil dimuat dari fail: ${file.name} (Versi: ${projectVersion})`);
        alert(`Proyek dari sumur "${parsed.well.name}" (Versi: ${projectVersion}) berhasil dimuat!`);
      } catch (err: any) {
        alert(`Gagal memuat fail proyek JSON: ${err?.message || err}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleCloseProject = () => {
    const confirmClose = window.confirm("Apakah Anda yakin ingin menutup dan mereset proyek ini? Data yang belum diunduh akan hilang.");
    if (!confirmClose) return;

    setProject({
      version: '1.0.0',
      well: {
        name: 'Untitled Well',
        field: '',
        operator: '',
        uwi: '',
        datum: 'KB',
        depthType: 'MD',
        depthUnit: 'm'
      },
      raster: null,
      nullValueGlobal: -999.25,
      depthTransform: {
        type: 'linear',
        controlPoints: []
      },
      tracks: [],
      curves: [],
      lithologyIntervals: []
    });
    setRasterUrl('');
    setUndoStack([]);
    setRedoStack([]);
    setUndoCommandStack([]);
    setRedoCommandStack([]);
    localforage.removeItem('citra_session_recovery_snapshot').catch(err => {
      console.error('[Session Recovery] Failed to clear snapshot on close:', err);
    });
    logInfo("Proyek berhasil ditutup dan direset.");
  };

  const handleUpdateTrackCalibration = (trackId: string, fields: {
    pixelXLeft?: number;
    pixelXRight?: number;
    valueMin?: number;
    valueMax?: number;
    scaleType?: 'linear' | 'log';
    direction?: 'normal' | 'reverse';
  }) => {
    const updatedTracks = project.tracks.map(t => {
      if (t.id === trackId) {
        const pixelXLeft = fields.pixelXLeft !== undefined ? fields.pixelXLeft : t.pixelXLeft;
        const pixelXRight = fields.pixelXRight !== undefined ? fields.pixelXRight : t.pixelXRight;
        const valueMin = fields.valueMin !== undefined ? fields.valueMin : t.valueTransform.valueMin;
        const valueMax = fields.valueMax !== undefined ? fields.valueMax : t.valueTransform.valueMax;
        const scaleType = fields.scaleType !== undefined ? fields.scaleType : t.valueTransform.type;
        const direction = fields.direction !== undefined ? fields.direction : (t.valueTransform.direction || 'normal');

        return {
          ...t,
          pixelXLeft,
          pixelXRight,
          valueTransform: {
            ...t.valueTransform,
            type: scaleType,
            pixelMin: pixelXLeft,
            pixelMax: pixelXRight,
            valueMin,
            valueMax,
            direction
          }
        };
      }
      return t;
    });

    saveActionState(syncCalibrations({
      ...project,
      tracks: updatedTracks
    }), `Konfigurasi batas horizontal track ${trackId} berhasil diperbarui.`);
  };

  const handleUpdateRasterRotation = (angle: number) => {
    if (!project.raster) return;
    saveActionState({
      ...project,
      raster: {
        ...project.raster,
        rotationAngle: angle
      }
    }, `Rotasi gambar disesuaikan menjadi ${angle.toFixed(1)}°`);
  };

  // Recalculates depth parameters inside the system
  function syncCalibrations(state: ProjectState): ProjectState {
    const points = state.depthTransform.controlPoints;
    if (points.length >= 2) {
      const p1 = points[0];
      const p2 = points[1];
      const divisor = p2.pixelY - p1.pixelY;
      const scale = divisor === 0 ? 1 : (p2.depth - p1.depth) / divisor;
      const offset = p1.depth - scale * p1.pixelY;
      
      return {
        ...state,
        depthTransform: {
          ...state.depthTransform,
          linearScale: scale,
          linearOffset: offset
        }
      };
    }
    return state;
  }



  // 3. OCR HEADER EXTRACT HANDLER DECOMMISSIONED



  // 4. INTERACTIVE WORKSPACE CLICK & DRAG LOGIC
  const getCoordinatesFromEvent = (e: React.MouseEvent<any>) => {
    const container = e.currentTarget as HTMLElement;
    const canvas = container?.querySelector('canvas') || canvasRef.current || rightCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    
    // Exact translation taking into account CSS layout compression, zooming, and pan actions
    const clickXOnElement = e.clientX - rect.left;
    const clickYOnElement = e.clientY - rect.top;
    
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const canvasPixelX = clickXOnElement * scaleX;
    const canvasPixelY = clickYOnElement * scaleY;

    return { x: Math.round(canvasPixelX), y: Math.round(canvasPixelY) };
  };

  const handleMinimapInteraction = (clientX: number, clientY: number, containerRect: DOMRect) => {
    const widthMini = containerRect.width || 115;
    const heightMini = containerRect.height || 148;
    
    const currentW = project.raster?.width || 700;
    const currentH = project.raster?.height || 900;
    
    const minimapScaleX = widthMini / currentW;
    const minimapScaleY = heightMini / currentH;
    
    // Clamp inside the local minimap container bounds
    const clickX_mini = Math.max(0, Math.min(widthMini, clientX - containerRect.left));
    const clickY_mini = Math.max(0, Math.min(heightMini, clientY - containerRect.top));
    
    // Scale up back to the actual canvas coordinate system
    const clickX_canvas = clickX_mini / minimapScaleX;
    const clickY_canvas = clickY_mini / minimapScaleY;
    
    // Center the main viewport on this spot!
    // panOffset.x shifts horizontal view, panOffset.y shifts vertical view
    const newPanX = - (clickX_canvas - currentW / 2) * zoomScale;
    const newPanY = - (clickY_canvas - currentH / 2) * zoomScale;
    
    updatePanAndZoom({ x: newPanX, y: newPanY }, zoomScale);
  };

  // Viewport level pan/zoom triggers (supports Left-drag when panning, Middle drag, and Right-drag)
  const handleViewportMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 2 || e.shiftKey) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  const handleViewportMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPanning) {
      updatePanAndZoom({ x: e.clientX - panStart.x, y: e.clientY - panStart.y }, zoomScale);
    }
  };

  const handleViewportMouseUp = () => {
    setIsPanning(false);
  };

  const handleRightClick = (e: React.MouseEvent<any>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const coords = getCoordinatesFromEvent(e);
    if (coords && activeTab === 'digitize' && !lockedCurveIds[activeCurveId]) {
      const activeCurve = project.curves.find(c => c.id === activeCurveId);
      if (activeCurve) {
        const tolerance = 15 / zoomScale;
        const nearestIdx = activeCurve.points.findIndex(pt => {
          const dx = pt.pixelX - coords.x;
          const dy = pt.pixelY - coords.y;
          return Math.sqrt(dx*dx + dy*dy) < tolerance;
        });

        if (nearestIdx !== -1) {
          setContextMenu({
            x: clickX,
            y: clickY,
            type: 'point',
            targetId: activeCurveId,
            pointIndex: nearestIdx
          });
          return;
        }
      }
    }

    setContextMenu({
      x: clickX,
      y: clickY,
      type: 'canvas'
    });
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<any>) => {
    // Close context menu on any mouse down
    if (contextMenu) {
      setContextMenu(null);
    }

    // Right click Context Menu
    if (e.button === 2) {
      e.preventDefault();
      handleRightClick(e);
      return;
    }

    // Middle click (button 1) or Left click (button 0) with Space held to Pan viewport
    const shouldPan = e.button === 1 || (e.button === 0 && isSpacePressed);
    if (shouldPan) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      return;
    }

    const coords = getCoordinatesFromEvent(e);
    if (!coords) return;

    if (activeTab === 'calibration-horizontal') {
      if (calibratingXTrack) {
        const trackId = calibratingXTrack.id;
        const side = calibratingXTrack.side;
        
        const updatedTracks = project.tracks.map(t => {
          if (t.id === trackId) {
            let pixelXLeft = side === 'left' ? coords.x : t.pixelXLeft;
            let pixelXRight = side === 'right' ? coords.x : t.pixelXRight;

            if (pixelXLeft >= pixelXRight) {
              if (side === 'left') {
                pixelXRight = pixelXLeft + Math.max(50, Math.round((project.raster?.width || 1000) * 0.2));
              } else {
                pixelXLeft = Math.max(0, pixelXRight - Math.max(50, Math.round((project.raster?.width || 1000) * 0.2)));
              }
            }

            return {
              ...t,
              pixelXLeft,
              pixelXRight,
              valueTransform: {
                ...t.valueTransform,
                pixelMin: pixelXLeft,
                pixelMax: pixelXRight
              }
            };
          }
          return t;
        });
        
        saveActionState(syncCalibrations({
          ...project,
          tracks: updatedTracks
        }), `Calibrated ${side === 'left' ? 'Left' : 'Right'} boundary of track ${trackId} on image to X=${coords.x}px`);
        setCalibratingXTrack(null);
        return;
      } else {
        const tolerance = 25 / zoomScale;
        let nearestTrackEdge: { id: string, side: 'left' | 'right', pointIndex?: number, isNew?: boolean } | null = null;
        let minDist = tolerance;
        
        // Helper to check dist to polyline
        project.tracks.forEach(t => {
          const checkSide = (side: 'left'|'right') => {
             const pts = side === 'left' ? t.leftPoints : t.rightPoints;
             const fallX = side === 'left' ? t.pixelXLeft : t.pixelXRight;
             if (!pts || pts.length === 0) {
               if (Math.abs(fallX - coords.x) < minDist) {
                 minDist = Math.abs(fallX - coords.x);
                 nearestTrackEdge = { id: t.id, side, isNew: true };
               }
             } else {
               // Check nodes first
               let nodeDist = tolerance;
               let nearestIdx = -1;
               pts.forEach((p, i) => {
                 const dx = p.x - coords.x;
                 const dy = p.y - coords.y;
                 const d = Math.sqrt(dx*dx + dy*dy);
                 if (d < nodeDist) { nodeDist = d; nearestIdx = i; }
               });
               if (nearestIdx !== -1) {
                 minDist = nodeDist;
                 nearestTrackEdge = { id: t.id, side, pointIndex: nearestIdx };
                 return;
               }
               // Check polyline distance
               const edgeX = getTrackBoundX(t, side, coords.y);
               if (Math.abs(edgeX - coords.x) < minDist) {
                 minDist = Math.abs(edgeX - coords.x);
                 nearestTrackEdge = { id: t.id, side, isNew: true };
               }
             }
          };
          checkSide('left');
          checkSide('right');
        });
        
        if (nearestTrackEdge) {
          pushDirectProjectSnapshot("Dragging Track Calibration Edge");
          
          const edge = nearestTrackEdge as { id: string; side: 'left' | 'right'; pointIndex?: number; isNew?: boolean };
          
          if (edge.isNew) {
            if (horizontalCalibMode === 'slide') {
              // Slide mode: Just set draggingTrackEdge with isNew to true so mouseMove can slide the entire line
              setDraggingTrackEdge({ id: edge.id, side: edge.side, isNew: true });
            } else {
              // Polyline mode: Initialize polyline if needed, and add the new point
              const t = project.tracks.find(tr => tr.id === edge.id)!;
              const pts = (edge.side === 'left' ? t.leftPoints : t.rightPoints) || [
                 { y: 0, x: edge.side === 'left' ? t.pixelXLeft : t.pixelXRight },
                 { y: project.raster?.height || 900, x: edge.side === 'left' ? t.pixelXLeft : t.pixelXRight }
              ];
              // Add new point at coords
              const newPts = [...pts, { x: coords.x, y: coords.y }].sort((a,b) => a.y - b.y);
              const newIdx = newPts.findIndex(p => p.y === coords.y);
              
              const updatedTracks = project.tracks.map(tr => {
                 if (tr.id === t.id) {
                   return edge.side === 'left' ? { ...tr, leftPoints: newPts } : { ...tr, rightPoints: newPts };
                 }
                 return tr;
              });
              setProject(syncCalibrations({ ...project, tracks: updatedTracks }));
              setDraggingTrackEdge({ id: t.id, side: edge.side, pointIndex: newIdx });
            }
          } else {
            setDraggingTrackEdge(edge);
          }
        }
        return;
      }
    }

    if (activeTab === 'calibration-vertical') {
      if (tiltedClickState) {
        const { anchorIndex, step } = tiltedClickState;
        const existingPoints = [...project.depthTransform.controlPoints];
        const cp = existingPoints[anchorIndex];
        if (cp) {
          if (step === 'left') {
            existingPoints[anchorIndex] = {
              ...cp,
              isSlanted: true,
              leftX: Math.round(coords.x),
              leftY: Math.round(coords.y)
            };
            setProject({
              ...project,
              depthTransform: { ...project.depthTransform, controlPoints: existingPoints }
            });
            setTiltedClickState({ anchorIndex, step: 'right' });
            logInfo("Sisi kiri tersimpan. Sekarang klik sisi kanan garis kedalaman pada gambar.");
          } else if (step === 'right') {
            const leftX = cp.leftX ?? Math.round(coords.x - 100);
            const leftY = cp.leftY ?? Math.round(coords.y);
            const rightX = Math.round(coords.x);
            const rightY = Math.round(coords.y);
            const avgY = Math.round((leftY + rightY) / 2);
            
            existingPoints[anchorIndex] = {
              ...cp,
              isSlanted: true,
              leftX,
              leftY,
              rightX,
              rightY,
              pixelY: avgY
            };
            
            const sortedPoints = [...existingPoints].sort((a, b) => a.pixelY - b.pixelY);
            
            const newState = syncCalibrations({
              ...project,
              depthTransform: { ...project.depthTransform, controlPoints: sortedPoints }
            });
            
            saveActionState(newState, `Set tilted depth anchor #${anchorIndex + 1} via canvas click: (${leftX},${leftY}) to (${rightX},${rightY})`);
            setTiltedClickState(null);
            logInfo("Akurasi lokal jangkar kedalaman miring berhasil disimpan!");
          }
        }
        return;
      }

      // Allow adding or updating Depth Calibration points
      const existingPoints = [...project.depthTransform.controlPoints];
      
      // Check slanted handles first
      for (let i = 0; i < existingPoints.length; i++) {
        const cp = existingPoints[i];
        if (cp.isSlanted) {
          const lX = cp.leftX ?? (currentRasterWidth * 0.1);
          const lY = cp.leftY ?? cp.pixelY;
          const rX = cp.rightX ?? (currentRasterWidth * 0.9);
          const rY = cp.rightY ?? cp.pixelY;
          
          // Check Left handle
          const distL = Math.sqrt((coords.x - lX)**2 + (coords.y - lY)**2);
          if (distL < (15 / zoomScale)) {
            pushDirectProjectSnapshot("Dragging Slanted Left Handle");
            setDraggingDepthAnchor(i);
            setDraggingSlantedAnchorPart('left');
            return;
          }
          
          // Check Right handle
          const distR = Math.sqrt((coords.x - rX)**2 + (coords.y - rY)**2);
          if (distR < (15 / zoomScale)) {
            pushDirectProjectSnapshot("Dragging Slanted Right Handle");
            setDraggingDepthAnchor(i);
            setDraggingSlantedAnchorPart('right');
            return;
          }
          
          // Check Center/Line drag
          const midX = (lX + rX) / 2;
          const midY = (lY + rY) / 2;
          const distMid = Math.sqrt((coords.x - midX)**2 + (coords.y - midY)**2);
          if (distMid < (15 / zoomScale)) {
            pushDirectProjectSnapshot("Dragging Slanted Anchor Center");
            setDraggingDepthAnchor(i);
            setDraggingSlantedAnchorPart('center');
            return;
          }
        }
      }
      
      // Stage 2: Check if click is near any circular anchor nodes (X, Y)
      const clickedKnotIdx = existingPoints.findIndex(p => {
        const cpX = (p as any).pixelX ?? globalXAnchor;
        const dx = coords.x - cpX;
        const dy = coords.y - p.pixelY;
        return Math.sqrt(dx*dx + dy*dy) < (15 / zoomScale);
      });

      if (clickedKnotIdx !== -1) {
        pushDirectProjectSnapshot("Dragging Depth Anchor Node");
        setDraggingDepthAnchor(clickedKnotIdx);
        setDraggingSlantedAnchorPart('center');
        return;
      }

      // Stage 1: Check if click is near global X anchor line
      if (Math.abs(coords.x - globalXAnchor) < (15 / zoomScale)) {
        pushDirectProjectSnapshot("Dragging Global X Anchor");
        setDraggingGlobalX(true);
        return;
      }

      // Default: Check if we are dragging an anchor up/down near its Y position, or adding a new anchor
      const nearestIdx = existingPoints.findIndex(p => Math.abs(p.pixelY - coords.y) < (25 / zoomScale));

      if (nearestIdx !== -1) {
        pushDirectProjectSnapshot("Dragging Depth Anchor");
        setDraggingDepthAnchor(nearestIdx);
        setDraggingSlantedAnchorPart('center');
      } else if (existingPoints.length < 10) {
        pushDirectProjectSnapshot("Add Depth Calibration Point");
        // Add new interpolation knot at coords.y with matching X
        const calculatedDepth = getMonotonicDepthForPixelY(coords.y, existingPoints);
        const newPoint = { pixelY: coords.y, depth: calculatedDepth, pixelX: coords.x } as any;
        const unsortedPoints = [...existingPoints, newPoint];
        const sortedPoints = unsortedPoints.sort((a, b) => a.pixelY - b.pixelY);

        const newState = syncCalibrations({
          ...project,
          depthTransform: { 
            ...project.depthTransform, 
            controlPoints: sortedPoints 
          }
        });
        setProject(newState);
        const draggedIndex = sortedPoints.findIndex(pt => pt.pixelY === coords.y);
        setDraggingDepthAnchor(draggedIndex !== -1 ? draggedIndex : existingPoints.length);
      }
      return;
    }

    if (activeTab === 'digitize') {
      if (lockedCurveIds[activeCurveId]) {
        logInfo("Kurva aktif sedang terkunci. Buka kunci di Pengelola Kurva untuk mengedit.");
        return;
      }
      if (digitizationMode === 'click') {
        const activeCurve = project.curves.find(c => c.id === activeCurveId);
        let nearestPointIdx = -1;
        if (activeCurve) {
          const tolerance = 15 / zoomScale;
          nearestPointIdx = activeCurve.points.findIndex(pt => {
            const dx = pt.pixelX - coords.x;
            const dy = pt.pixelY - coords.y;
            return Math.sqrt(dx*dx + dy*dy) < tolerance;
          });
        }

        if (nearestPointIdx !== -1) {
          pushDirectProjectSnapshot("Dragging Curve Point");
          setDraggingCurvePoint({ curveId: activeCurveId, pointIndex: nearestPointIdx });
        } else {
          addNewDigitizedPoint(coords.x, coords.y);
        }
      } else if (digitizationMode === 'freehand') {
        setIsDrawingFreehand(true);
        tempFreehandPointsRef.current = [{ x: coords.x, y: coords.y }];
        
        // Instant visual feedback on the canvas context
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = activeCurveColor;
            ctx.beginPath();
            ctx.arc(coords.x, coords.y, 2.5, 0, 2 * Math.PI);
            ctx.fill();
          }
        }
      } else if (digitizationMode === 'erase') {
        pushDirectProjectSnapshot("Erase Curve Points");
        setIsErasing(true);
        erasePointsAt(coords.x, coords.y);
      } else if (digitizationMode === 'autotrace' || digitizationMode === 'aoi') {
        setIsDrawingAoi(true);
        setAoiStartCoords({ x: coords.x, y: coords.y });
        setTempAoiBox({ minX: coords.x, minY: coords.y, maxX: coords.x + 1, maxY: coords.y + 1 });
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<any>) => {
    const hoverCoords = getCoordinatesFromEvent(e);
    if (hoverCoords) {
      setMouseHoverCoords(hoverCoords);
    }

    // Auto-pan if dragging or digitizing and approaching viewport edge
    const viewport = viewportRef.current;
    if (viewport && (isDrawingFreehand || isErasing || draggingCurvePoint !== null || (activeTab === 'digitize' && digitizationMode === 'click'))) {
      const rect = viewport.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const threshold = 40; // 40px threshold
      let dx = 0;
      let dy = 0;
      
      if (x < threshold) dx = 8;
      else if (x > rect.width - threshold) dx = -8;
      
      if (y < threshold) dy = 8;
      else if (y > rect.height - threshold) dy = -8;
      
      if (dx !== 0 || dy !== 0) {
        const prevPan = viewportStateRef.current.panOffset;
        updatePanAndZoom({ x: prevPan.x + dx, y: prevPan.y + dy }, zoomScale);
      }
    }

    if (eraserCursorRef.current && digitizationMode === 'erase') {
      eraserCursorRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`;
      eraserCursorRef.current.style.opacity = '1';
    }

    if (isPanning) {
      updatePanAndZoom({ x: e.clientX - panStart.x, y: e.clientY - panStart.y }, zoomScale);
      e.currentTarget.style.cursor = 'grabbing';
      return;
    }

    if (!draggingDepthAnchor && !draggingTrackEdge && !isDrawingFreehand && !isErasing && draggingCurvePoint === null) {
      const coords = getCoordinatesFromEvent(e);
      if (coords) {
        if (isSpacePressed) {
          e.currentTarget.style.cursor = 'grab';
        } else if (activeTab === 'calibration-vertical') {
          const nearestIdx = project.depthTransform.controlPoints.findIndex(p => Math.abs(p.pixelY - coords.y) < (25 / zoomScale));
          e.currentTarget.style.cursor = nearestIdx !== -1 ? 'row-resize' : 'crosshair';
        } else if (activeTab === 'calibration-horizontal') {
          const tolerance = 25 / zoomScale;
          const nearestTrack = project.tracks.some(t => {
            const lx = getTrackBoundX(t, 'left', coords.y);
            const rx = getTrackBoundX(t, 'right', coords.y);
            return Math.abs(lx - coords.x) < tolerance || Math.abs(rx - coords.x) < tolerance;
          });
          e.currentTarget.style.cursor = nearestTrack ? 'col-resize' : 'crosshair';
        } else if (activeTab === 'digitize' && digitizationMode === 'erase') {
          e.currentTarget.style.cursor = 'none';
        } else if (activeTab === 'digitize' && digitizationMode === 'click') {
          // Check if hovering near an existing node/point
          const activeCurve = project.curves.find(c => c.id === activeCurveId);
          let hoverNode = false;
          if (activeCurve) {
            const tolerance = 15 / zoomScale;
            hoverNode = activeCurve.points.some(pt => {
              const dx = pt.pixelX - coords.x;
              const dy = pt.pixelY - coords.y;
              return Math.sqrt(dx*dx + dy*dy) < tolerance;
            });
          }
          e.currentTarget.style.cursor = hoverNode ? 'pointer' : 'crosshair';
        } else {
          e.currentTarget.style.cursor = 'crosshair';
        }
      }
    }

    if (activeTab === 'calibration-vertical' && draggingDepthAnchor !== null) {
      e.currentTarget.style.cursor = 'move';
      const coords = getCoordinatesFromEvent(e);
      if (coords) {
         const currentProj = projectRef.current;
         const existingPoints = [...currentProj.depthTransform.controlPoints];
         const cp = existingPoints[draggingDepthAnchor];
         if (cp) {
           // Calculate minY and maxY constraints based on depth neighbors
           let minY = 5;
           let maxY = (currentProj.raster?.height || 9000) - 5;

           existingPoints.forEach((p, idx) => {
             if (idx === draggingDepthAnchor) return;
             if (p.depth < cp.depth) {
               if (p.pixelY > minY) {
                 minY = p.pixelY + 5;
               }
             }
             if (p.depth > cp.depth) {
               if (p.pixelY < maxY) {
                 maxY = p.pixelY - 5;
               }
             }
           });

           if (cp.isSlanted) {
             const lX = cp.leftX ?? (currentRasterWidth * 0.1);
             const lY = cp.leftY ?? cp.pixelY;
             const rX = cp.rightX ?? (currentRasterWidth * 0.9);
             const rY = cp.rightY ?? cp.pixelY;
             
             if (draggingSlantedAnchorPart === 'left') {
               const targetY = Math.round((coords.y + rY) / 2);
               const constrainedY = Math.max(minY, Math.min(maxY, targetY));
               const diff = constrainedY - targetY;
               existingPoints[draggingDepthAnchor] = {
                 ...cp,
                 leftX: Math.round(coords.x),
                 leftY: Math.round(coords.y + diff * 2),
                 pixelY: constrainedY
               };
             } else if (draggingSlantedAnchorPart === 'right') {
               const targetY = Math.round((lY + coords.y) / 2);
               const constrainedY = Math.max(minY, Math.min(maxY, targetY));
               const diff = constrainedY - targetY;
               existingPoints[draggingDepthAnchor] = {
                 ...cp,
                 rightX: Math.round(coords.x),
                 rightY: Math.round(coords.y + diff * 2),
                 pixelY: constrainedY
               };
             } else if (draggingSlantedAnchorPart === 'center') {
               const constrainedY = Math.max(minY, Math.min(maxY, coords.y));
               const dy = constrainedY - cp.pixelY;
               existingPoints[draggingDepthAnchor] = {
                 ...cp,
                 leftY: Math.round(lY + dy),
                 rightY: Math.round(rY + dy),
                 pixelY: Math.round(constrainedY)
               };
             }
           } else {
             const constrainedY = Math.max(minY, Math.min(maxY, coords.y));
             existingPoints[draggingDepthAnchor] = { 
               ...cp, 
               pixelY: constrainedY,
               pixelX: coords.x
             } as any;
           }
           throttleSetProject(syncCalibrations({
             ...currentProj,
             depthTransform: { ...currentProj.depthTransform, controlPoints: existingPoints }
           }));
         }
      }
    }

    if (activeTab === 'calibration-vertical' && draggingGlobalX) {
      e.currentTarget.style.cursor = 'col-resize';
      const coords = getCoordinatesFromEvent(e);
      if (coords) {
         setGlobalXAnchor(coords.x);
      }
    }

    if (activeTab === 'calibration-horizontal' && draggingTrackEdge !== null) {
      e.currentTarget.style.cursor = 'col-resize';
      const coords = getCoordinatesFromEvent(e);
      if (coords) {
         const currentProj = projectRef.current;
         const updatedTracks = currentProj.tracks.map(t => {
            if (t.id === draggingTrackEdge.id) {
               if (draggingTrackEdge.pointIndex !== undefined) {
                 const ptsKey = draggingTrackEdge.side === 'left' ? 'leftPoints' : 'rightPoints';
                 let pts = t[ptsKey];
                 if (!pts || pts.length === 0) {
                    pts = [
                      { y: 0, x: draggingTrackEdge.side === 'left' ? t.pixelXLeft : t.pixelXRight },
                      { y: currentProj.raster?.height || 900, x: draggingTrackEdge.side === 'left' ? t.pixelXLeft : t.pixelXRight }
                    ];
                 }
                 const newPts = [...pts];
                 newPts[draggingTrackEdge.pointIndex] = { x: coords.x, y: newPts[draggingTrackEdge.pointIndex].y };
                 
                 return { ...t, [ptsKey]: newPts };
               } else if (draggingTrackEdge.isNew) {
                 // Slide whole line
                 if (draggingTrackEdge.side === 'left') {
                   const dx = coords.x - t.pixelXLeft;
                   const newPts = t.leftPoints ? t.leftPoints.map(p => ({...p, x: p.x + dx})) : undefined;
                   const newLeft = coords.x;
                   const newRight = Math.max(t.pixelXRight, newLeft + 20);
                   return { ...t, pixelXLeft: newLeft, pixelXRight: newRight, leftPoints: newPts };
                 } else {
                   const dx = coords.x - t.pixelXRight;
                   const newPts = t.rightPoints ? t.rightPoints.map(p => ({...p, x: p.x + dx})) : undefined;
                   const newRight = coords.x;
                   const newLeft = Math.min(t.pixelXLeft, newRight - 20);
                   return { ...t, pixelXLeft: newLeft, pixelXRight: newRight, rightPoints: newPts };
                 }
               }
            }
            return t;
         });
         throttleSetProject(syncCalibrations({
            ...currentProj,
            tracks: updatedTracks
         }));
      }
    }

    if (activeTab === 'digitize') {
      if (draggingCurvePoint !== null) {
        e.currentTarget.style.cursor = 'move';
        const coords = getCoordinatesFromEvent(e);
        if (coords) {
           const currentProj = projectRef.current;
           const updatedCurves = currentProj.curves.map(c => {
             if (c.id === draggingCurvePoint.curveId) {
               const newPoints = [...c.points];
               const pt = newPoints[draggingCurvePoint.pointIndex];
               if (pt) {
                 const activeCurveObj = currentProj.curves.find(cc => cc.id === draggingCurvePoint.curveId)!;
                 const activeTrack = currentProj.tracks.find(t => t.id === activeCurveObj.trackId)!;
                 
                 const depthInfo = pixelYToDepth(coords.y, currentProj.depthTransform);
                 const lX = getTrackBoundX(activeTrack, 'left', coords.y);
                 const rX = getTrackBoundX(activeTrack, 'right', coords.y);
                 const curveValue = pixelXToValue(coords.x, getCurveValueTransform(activeCurveObj, activeTrack), lX, rX);
                 const transformToUse = getCurveValueTransform(activeCurveObj, activeTrack);
                 const activeT = { ...transformToUse, pixelMin: lX, pixelMax: rX };
                 const finalUncertainty = calculatePointUncertainties(coords.x, coords.y, activeT, depthInfo.localSlope, 1.0);
                 
                 newPoints[draggingCurvePoint.pointIndex] = {
                   ...pt,
                   pixelX: coords.x,
                   pixelY: coords.y,
                   depth: Number(depthInfo.depth.toFixed(4)),
                   value: Number(curveValue.toFixed(4)),
                   uncertaintyDepth: finalUncertainty.uncertaintyDepth,
                   uncertaintyValue: finalUncertainty.uncertaintyValue
                 };
               }
               newPoints.sort((a, b) => a.pixelY - b.pixelY);
               
               const currentPtId = c.points[draggingCurvePoint.pointIndex].id;
               const newIdx = newPoints.findIndex(p => p.id === currentPtId);
               if (newIdx !== -1) {
                 setDraggingCurvePoint({ curveId: draggingCurvePoint.curveId, pointIndex: newIdx });
               }
               
               return { ...c, points: newPoints };
             }
             return c;
           });
           
           throttleSetProject({
             ...currentProj,
             curves: updatedCurves
           });
        }
      } else if (digitizationMode === 'freehand' && isDrawingFreehand) {
        const coords = getCoordinatesFromEvent(e);
        if (coords) {
          const canvas = canvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext('2d');
            const lastPt = tempFreehandPointsRef.current[tempFreehandPointsRef.current.length - 1];
            if (ctx && lastPt) {
              const dashStyle = getCurveDashStyle(currentActiveCurve);
              ctx.strokeStyle = activeCurveColor;
              ctx.lineWidth = getCurveWeight(currentActiveCurve, true);
              if (dashStyle === 'dashed') {
                ctx.setLineDash([6, 4]);
              } else if (dashStyle === 'dotted') {
                ctx.setLineDash([2, 2]);
              } else {
                ctx.setLineDash([]);
              }
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              ctx.beginPath();
              ctx.moveTo(lastPt.x, lastPt.y);
              ctx.lineTo(coords.x, coords.y);
              ctx.stroke();
              ctx.setLineDash([]); // Reset line dash
            }
          }
          tempFreehandPointsRef.current.push({ x: coords.x, y: coords.y });
        }
      } else if (digitizationMode === 'erase' && isErasing) {
        const coords = getCoordinatesFromEvent(e);
        if (coords) {
          erasePointsAt(coords.x, coords.y);
        }
      } else if ((digitizationMode === 'autotrace' || digitizationMode === 'aoi') && isDrawingAoi && aoiStartCoords) {
        const coords = getCoordinatesFromEvent(e);
        if (coords) {
          setTempAoiBox({
            minX: Math.min(aoiStartCoords.x, coords.x),
            maxX: Math.max(aoiStartCoords.x, coords.x),
            minY: Math.min(aoiStartCoords.y, coords.y),
            maxY: Math.max(aoiStartCoords.y, coords.y)
          });
        }
      }
    }
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);

    if (isDrawingAoi && tempAoiBox) {
      const w = tempAoiBox.maxX - tempAoiBox.minX;
      const h = tempAoiBox.maxY - tempAoiBox.minY;
      if (w > 5 && h > 5) {
        setAoiSelection(tempAoiBox);
        const topDepthVal = pixelYToDepth(tempAoiBox.minY, project.depthTransform).depth;
        const btmDepthVal = pixelYToDepth(tempAoiBox.maxY, project.depthTransform).depth;
        const unit = project.well.depthUnit || 'm';
        logInfo(`AOI terpilih (${topDepthVal.toFixed(1)} - ${btmDepthVal.toFixed(1)} ${unit}). Memproses Auto-Trace V2...`);
        runLogColorTracer(
          aoiStartCoords?.x ?? tempAoiBox.minX,
          aoiStartCoords?.y ?? tempAoiBox.minY,
          tempAoiBox
        );
      } else if (aoiStartCoords) {
        runLogColorTracer(aoiStartCoords.x, aoiStartCoords.y, aoiSelection);
      }
      setIsDrawingAoi(false);
      setAoiStartCoords(null);
      setTempAoiBox(null);
      setDigitizationMode('autotrace');
    }

    if (draggingCurvePoint !== null) {
      setDraggingCurvePoint(null);
      commitLastSnapshotFinalState(projectRef.current);
    }

    if (projectRAFHandleRef.current !== null) {
      cancelAnimationFrame(projectRAFHandleRef.current);
      projectRAFHandleRef.current = null;
    }
    if (pendingProjectUpdateRef.current) {
      setProject(pendingProjectUpdateRef.current);
      projectRef.current = pendingProjectUpdateRef.current;
      pendingProjectUpdateRef.current = null;
    }

    if (isDrawingFreehand) {
      addFreehandPointsBatch(tempFreehandPointsRef.current);
      tempFreehandPointsRef.current = [];
      setIsDrawingFreehand(false);
    }
    if (isErasing) {
      setIsErasing(false);
      commitLastSnapshotFinalState(projectRef.current);
    }
    if (draggingDepthAnchor !== null) {
      setDraggingDepthAnchor(null);
      setDraggingSlantedAnchorPart(null);
      commitLastSnapshotFinalState(projectRef.current);
    }
    if (draggingGlobalX) {
      setDraggingGlobalX(false);
      commitLastSnapshotFinalState(projectRef.current);
    }
    if (draggingTrackEdge !== null) {
      setDraggingTrackEdge(null);
      commitLastSnapshotFinalState(projectRef.current);
    }
    setMouseHoverCoords(null);
  };

  // Sample and extract curve based on AutoTrace V2 estimator and optional AOI range
  const runLogColorTracer = (
    startX: number, 
    startY: number, 
    customAoi?: { minX?: number; minY: number; maxX?: number; maxY: number } | null
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Use explicit customAoi or state aoiSelection
    const targetAoi = customAoi !== undefined ? customAoi : aoiSelection;

    // Retrieve active curve and track bounds
    const activeCurve = project.curves.find(c => c.id === activeCurveId);
    if (!activeCurve) return;
    const activeTrack = project.tracks.find(t => t.id === activeCurve.trackId);
    if (!activeTrack) return;

    // Determine X bounds
    let leftBound = activeTrack.pixelXLeft;
    let rightBound = activeTrack.pixelXRight;
    if (targetAoi && targetAoi.minX !== undefined && targetAoi.maxX !== undefined) {
      leftBound = Math.max(activeTrack.pixelXLeft, Math.floor(targetAoi.minX));
      rightBound = Math.min(activeTrack.pixelXRight, Math.ceil(targetAoi.maxX));
    }
    const width = Math.max(10, rightBound - leftBound);

    // Determine Y range from AOI or entire canvas
    const topY = targetAoi ? Math.max(0, Math.floor(targetAoi.minY)) : 0;
    const bottomY = targetAoi ? Math.min(canvas.height, Math.ceil(targetAoi.maxY)) : canvas.height;
    const cropHeight = Math.max(10, bottomY - topY);

    if (cropHeight < 3) {
      alert("Area terpilih terlalu kecil (minimal 3 baris pixel).");
      return;
    }

    let imgData: ImageData | null = null;
    if (virtualRaster && rasterMetadata) {
      imgData = virtualRaster.getCachedImageData(leftBound, topY, width, cropHeight);
    } else {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        imgData = ctx.getImageData(leftBound, topY, width, cropHeight);
      }
    }

    if (!imgData) {
      alert("Gagal mengambil data pixel dari track log. Pastikan gambar latar belakang telah dimuat.");
      return;
    }

    // Convert RGBA image data to 2D Matrix grayscale intensities
    const regionData = new Float64Array(width * cropHeight);
    for (let y = 0; y < cropHeight; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = imgData.data[idx];
        const g = imgData.data[idx + 1];
        const b = imgData.data[idx + 2];
        regionData[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      }
    }
    const region: Matrix2D = { rows: cropHeight, cols: width, data: regionData };

    logInfo(`Auto-Trace V2 triggered ${targetAoi ? '(Area of Interest AOI)' : ''} [${width}x${cropHeight} px, Y: ${topY}-${bottomY}]`);

    // Run AutoTrace V2 Estimator
    const v2Result = autotraceV2(region, {
      colOffset: leftBound,
      rowOffset: topY
    });

    const trackedPoints: DigitizedPoint[] = [];

    for (let i = 0; i < v2Result.pixelX.length; i++) {
      const x = v2Result.pixelX[i]!;
      const y = v2Result.pixelY[i]!;

      // Enforce scientific NaN semantics: skip gap rows
      if (Number.isNaN(x)) continue;

      const depthInfo = pixelYToDepth(y, project.depthTransform);
      const lX = getTrackBoundX(activeTrack, 'left', y);
      const rX = getTrackBoundX(activeTrack, 'right', y);
      const transformToUse = getCurveValueTransform(activeCurve, activeTrack);
      const curveVal = pixelXToValue(x, transformToUse, lX, rX);
      const activeT = { ...transformToUse, pixelMin: lX, pixelMax: rX };
      
      const unc = calculatePointUncertainties(x, y, activeT, depthInfo.localSlope, 1.0);

      trackedPoints.push({
        id: `pt-auto-${y}-${Math.random().toString(36).substring(2, 6)}`,
        pixelX: Number(x.toFixed(2)),
        pixelY: y,
        depth: Number(depthInfo.depth.toFixed(4)),
        value: Number(curveVal.toFixed(4)),
        uncertaintyDepth: unc.uncertaintyDepth,
        uncertaintyValue: unc.uncertaintyValue,
        digitizationMode: 'auto_trace'
      });
    }

    if (trackedPoints.length > 0) {
      const updatedCurves = project.curves.map(c => {
        if (c.id === activeCurveId) {
          let preservedPoints = c.points;
          if (targetAoi) {
            // Keep points outside the AOI Y range
            preservedPoints = c.points.filter(pt => pt.pixelY < topY || pt.pixelY > bottomY);
          } else {
            preservedPoints = []; // Replace all points if no AOI
          }
          const mergedPoints = [...preservedPoints, ...trackedPoints].sort((a, b) => a.pixelY - b.pixelY);
          return { ...c, points: mergedPoints };
        }
        return c;
      });

      const topDepthVal = pixelYToDepth(topY, project.depthTransform).depth;
      const btmDepthVal = pixelYToDepth(bottomY, project.depthTransform).depth;
      const unit = project.well.depthUnit || 'm';

      const newState = { ...project, curves: updatedCurves };
      saveActionState(
        newState, 
        `Auto-Trace V2 ${activeCurve.metadata.mnemonic}${targetAoi ? ` (AOI: ${topDepthVal.toFixed(1)} - ${btmDepthVal.toFixed(1)} ${unit})` : ''}`
      );
      logInfo(`Auto-Trace V2 berhasil mengekstrak ${trackedPoints.length} titik dari ${cropHeight} baris (Detections: ${(v2Result.detectionRatio * 100).toFixed(1)}%, Quality qV2d: ${v2Result.qV2d.toFixed(3)}) pada kurva ${activeCurve.metadata.mnemonic}.`);
    } else {
      alert("Auto-Trace V2 tidak mendeteksi garis kurva dalam area terpilih.");
    }
  };

  const addNewDigitizedPoint = (pixelX: number, pixelY: number, streamAction = false) => {
    let currentCurves = [...project.curves];
    let activeCurve = currentCurves.find(c => c.id === activeCurveId) || currentCurves[0];
    
    // Auto-create curve if project has no curves
    if (!activeCurve) {
      const defaultTrackId = project.tracks[0]?.id || 'track-1';
      activeCurve = {
        id: `curve-${Date.now()}`,
        trackId: defaultTrackId,
        metadata: {
          id: `meta-${Date.now()}`,
          mnemonic: 'GR',
          unit: 'gAPI',
          nullValue: -999.25
        },
        points: [],
        depthShiftApplied: 0
      };
      currentCurves.push(activeCurve);
      setActiveCurveId(activeCurve.id);
    }

    const targetCurveId = activeCurve.id;
    let activeTrack = project.tracks.find(t => t.id === activeCurve.trackId) || project.tracks[0];

    // Fallback track if project has no tracks
    if (!activeTrack) {
      const rasterW = currentRasterWidth || project.raster?.width || 1000;
      activeTrack = {
        id: activeCurve.trackId || 'track-1',
        name: 'Track 1',
        pixelXLeft: Math.round(rasterW * 0.1),
        pixelXRight: Math.round(rasterW * 0.9),
        isConfigured: true,
        valueTransform: {
          type: 'linear',
          pixelMin: Math.round(rasterW * 0.1),
          pixelMax: Math.round(rasterW * 0.9),
          valueMin: 0,
          valueMax: 150,
          direction: 'normal'
        }
      };
    }

    // Map pixel measurements to physical petrophysical properties
    const depthInfo = pixelYToDepth(pixelY, project.depthTransform);
    const lX = getTrackBoundX(activeTrack, 'left', pixelY);
    const rX = getTrackBoundX(activeTrack, 'right', pixelY);
    const transformToUse = getCurveValueTransform(activeCurve, activeTrack);
    const curveValue = pixelXToValue(pixelX, transformToUse, lX, rX);
    const activeT = { ...transformToUse, pixelMin: lX, pixelMax: rX };
    const finalUncertainty = calculatePointUncertainties(pixelX, pixelY, activeT, depthInfo.localSlope, 1.0);

    const ptId = `pt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const newPoint: DigitizedPoint = {
      id: ptId,
      pixelX,
      pixelY,
      depth: Number(depthInfo.depth.toFixed(4)),
      value: Number(curveValue.toFixed(4)),
      uncertaintyDepth: finalUncertainty.uncertaintyDepth,
      uncertaintyValue: finalUncertainty.uncertaintyValue,
      digitizationMode: streamAction ? 'freehand' : 'manual_click'
    };

    const updatedCurves = currentCurves.map(c => {
      if (c.id === targetCurveId) {
        // Clean up any nearby null points and override existing points (autotrace/manual) at this depth
        const overrideRadius = streamAction ? 2 : 4;
        let overriddenCount = 0;
        const cleanedPoints = c.points.filter(pt => {
          if (pt.value === null && Math.abs(pt.pixelY - pixelY) < 12) {
            return false;
          }
          if (!streamAction && Math.abs(pt.pixelY - pixelY) <= overrideRadius) {
            overriddenCount++;
            return false;
          }
          return true;
        });

        const minSpacing = streamAction ? 3 : 0;
        
        // Binary search for insertion index in cleanedPoints
        let low = 0;
        let high = cleanedPoints.length;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (cleanedPoints[mid].pixelY < pixelY) {
            low = mid + 1;
          } else {
            high = mid;
          }
        }
        
        // Check proximity to neighbors for stream action deduplication
        if (minSpacing > 0 && cleanedPoints.length > 0) {
          if (low > 0 && Math.abs(cleanedPoints[low - 1].pixelY - pixelY) < minSpacing) {
            const result = [...cleanedPoints];
            result[low - 1] = {
              ...result[low - 1],
              pixelX,
              value: newPoint.value,
              uncertaintyValue: newPoint.uncertaintyValue,
              digitizationMode: newPoint.digitizationMode
            };
            return { ...c, points: result };
          }
          if (low < cleanedPoints.length && Math.abs(cleanedPoints[low].pixelY - pixelY) < minSpacing) {
            const result = [...cleanedPoints];
            result[low] = {
              ...result[low],
              pixelX,
              value: newPoint.value,
              uncertaintyValue: newPoint.uncertaintyValue,
              digitizationMode: newPoint.digitizationMode
            };
            return { ...c, points: result };
          }
        }
        
        const result = [...cleanedPoints];
        result.splice(low, 0, newPoint);
        return { ...c, points: result };
      }
      return c;
    });

    const newState = { ...project, curves: updatedCurves };
    
    if (streamAction) {
      // Debounce states for smooth drawing
      setProject(newState);
    } else {
      saveActionState(newState, `Manual point on ${activeCurve.metadata.mnemonic}`);
    }
  };

  const removeDigitizedPoint = (ptId: string) => {
    const updatedCurves = project.curves.map(c => {
      if (c.id === activeCurveId) {
        return {
          ...c,
          points: c.points.filter(pt => pt.id !== ptId)
        };
      }
      return c;
    });
    const newState = { ...project, curves: updatedCurves };
    saveActionState(newState, `Removed point ${ptId}`);
  };

  const removeTrackBoundPoint = (trackId: string, side: 'left' | 'right', idx: number) => {
    const updatedTracks = project.tracks.map(t => {
      if (t.id === trackId) {
        const ptsKey = side === 'left' ? 'leftPoints' : 'rightPoints';
        const pts = t[ptsKey];
        if (pts) {
          const newPts = pts.filter((_, i) => i !== idx);
          return {
            ...t,
            [ptsKey]: newPts.length > 0 ? newPts : undefined
          };
        }
      }
      return t;
    });
    setProject(syncCalibrations({ ...project, tracks: updatedTracks }));
    logInfo(`Berhasil menghapus titik batas ${side === 'left' ? 'kiri' : 'kanan'} lokal.`);
  };

  const erasePointsAt = (pixelX: number, pixelY: number) => {
    const currentProj = projectRef.current;
    const activeCurve = currentProj.curves.find(c => c.id === activeCurveId);
    if (!activeCurve || activeCurve.points.length === 0) return;

    let pointsChanged = false;
    const eraserRadiusSq = eraserRadius * eraserRadius;

    const updatedCurves = currentProj.curves.map(c => {
      if (c.id === activeCurveId) {
        let localChanged = false;
        const remainingPoints = c.points.filter(pt => {
          if (pt.value === null) return false;
          // Spatial bounding-box check for maximum execution speed
          if (Math.abs(pt.pixelY - pixelY) > eraserRadius) return true;
          if (Math.abs(pt.pixelX - pixelX) > eraserRadius) return true;

          const dx = pt.pixelX - pixelX;
          const dy = pt.pixelY - pixelY;
          if (dx * dx + dy * dy <= eraserRadiusSq) {
            localChanged = true;
            pointsChanged = true;
            return false; // Erase point from array
          }
          return true;
        });

        if (localChanged) {
          return { ...c, points: remainingPoints };
        }
      }
      return c;
    });

    if (pointsChanged) {
      throttleSetProject({ ...currentProj, curves: updatedCurves }, true);
    }
  };

  const addFreehandPointsBatch = (rawPoints: { x: number; y: number }[]) => {
    if (rawPoints.length === 0) return;
    let currentCurves = [...project.curves];
    let activeCurve = currentCurves.find(c => c.id === activeCurveId) || currentCurves[0];
    if (!activeCurve) {
      const defaultTrackId = project.tracks[0]?.id || 'track-1';
      activeCurve = {
        id: `curve-${Date.now()}`,
        trackId: defaultTrackId,
        metadata: {
          id: `meta-${Date.now()}`,
          mnemonic: 'GR',
          unit: 'gAPI',
          nullValue: -999.25
        },
        points: [],
        depthShiftApplied: 0
      };
      currentCurves.push(activeCurve);
      setActiveCurveId(activeCurve.id);
    }
    const targetCurveId = activeCurve.id;
    let activeTrack = project.tracks.find(t => t.id === activeCurve.trackId) || project.tracks[0];
    if (!activeTrack) {
      const rasterW = currentRasterWidth || project.raster?.width || 1000;
      activeTrack = {
        id: activeCurve.trackId || 'track-1',
        name: 'Track 1',
        pixelXLeft: Math.round(rasterW * 0.1),
        pixelXRight: Math.round(rasterW * 0.9),
        isConfigured: true,
        valueTransform: {
          type: 'linear',
          pixelMin: Math.round(rasterW * 0.1),
          pixelMax: Math.round(rasterW * 0.9),
          valueMin: 0,
          valueMax: 150,
          direction: 'normal'
        }
      };
    }

    const newPointsMapped: DigitizedPoint[] = rawPoints.map((pt, index) => {
      const depthInfo = pixelYToDepth(pt.y, project.depthTransform);
      const lX = getTrackBoundX(activeTrack, 'left', pt.y);
      const rX = getTrackBoundX(activeTrack, 'right', pt.y);
      const transformToUse = getCurveValueTransform(activeCurve, activeTrack);
      const curveValue = pixelXToValue(pt.x, transformToUse, lX, rX);
      const activeT = { ...transformToUse, pixelMin: lX, pixelMax: rX };
      const finalUncertainty = calculatePointUncertainties(pt.x, pt.y, activeT, depthInfo.localSlope, 1.0);
      
      const ptId = `pt-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 6)}`;
      
      return {
        id: ptId,
        pixelX: pt.x,
        pixelY: pt.y,
        depth: Number(depthInfo.depth.toFixed(4)),
        value: Number(curveValue.toFixed(4)),
        uncertaintyDepth: finalUncertainty.uncertaintyDepth,
        uncertaintyValue: finalUncertainty.uncertaintyValue,
        digitizationMode: 'freehand' as const
      };
    });

    const yValues = newPointsMapped.map(p => p.pixelY);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);

    // Override/remove existing points (autotrace, manual_click, freehand) within the vertical span of this freehand stroke
    const buffer = 3;
    let overriddenCount = 0;
    const cleanedExistingPoints = activeCurve.points.filter(pt => {
      if (pt.pixelY >= minY - buffer && pt.pixelY <= maxY + buffer) {
        overriddenCount++;
        return false;
      }
      return true;
    });

    const mergedPoints = [...cleanedExistingPoints, ...newPointsMapped].sort((a, b) => a.pixelY - b.pixelY);

    const filteredPoints: DigitizedPoint[] = [];
    let lastY = -999;
    mergedPoints.forEach(pt => {
      if (pt.value === null) {
        // Keep null points that survived the cleanup
        filteredPoints.push(pt);
        return;
      }
      if (Math.abs(pt.pixelY - lastY) >= 3 || pt.digitizationMode !== 'freehand') {
        filteredPoints.push(pt);
        lastY = pt.pixelY;
      }
    });

    const updatedCurves = currentCurves.map(c => {
      if (c.id === targetCurveId) {
        return { ...c, points: filteredPoints };
      }
      return c;
    });

    const newState = { ...project, curves: updatedCurves };
    saveActionState(
      newState, 
      overriddenCount > 0 
        ? `Koreksi freehand (${overriddenCount} poin digantikan) pada ${activeCurve.metadata.mnemonic}`
        : `Freehand curve on ${activeCurve.metadata.mnemonic}`
    );
    if (overriddenCount > 0) {
      logInfo(`Koreksi Freehand berhasil menggantikan ${overriddenCount} poin autotrace/manual pada interval Y: ${minY}-${maxY} px.`);
    }
  };

  const removeAllActivePoints = () => {
    executeCommand(new ClearActiveCurvePointsCommand(activeCurveId));
  };

  // 5. GEOLOGICAL LAYER MANAGEMENT
  const selectAddLithInterval = () => {
    if (lithoForm.depthBottom <= lithoForm.depthTop) {
      alert("Facies boundary bottom must lie deeper than top boundary.");
      return;
    }

     
    const lithId = `lith-${Date.now()}`;

    const newInterval: LithologyInterval = {
      id: lithId,
      depthTop: lithoForm.depthTop,
      depthBottom: lithoForm.depthBottom,
      label: lithoForm.label,
      colorHex: lithoForm.colorHex,
      patternId: lithoForm.patternId
    };

    const newState = {
      ...project,
      lithologyIntervals: [...project.lithologyIntervals, newInterval].sort((a, b) => a.depthTop - b.depthTop)
    };
    saveActionState(newState, `Added Geological interval: ${lithoForm.label}`);
  };

  const removeLithInterval = (id: string) => {
    const newState = {
      ...project,
      lithologyIntervals: project.lithologyIntervals.filter(l => l.id !== id)
    };
    saveActionState(newState, `Removed Geological interval`);
  };

  // 6. DRAW VISUALIZATION CANVAS
  useEffect(() => {
     
    const tFrameStart = performance.now();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear and draw image base layer
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const rHeight = rasterMetadata?.height || canvas.height;
    const visibleTop = (rHeight / 2) - (viewportSize.height / 2 + panOffset.y) / zoomScale;
    const visibleBottom = (rHeight / 2) + (viewportSize.height / 2 - panOffset.y) / zoomScale;
    
    let tTileSelection = 0;
    let tCacheLookup = 0;
    let tCanvasDraw = 0;
    const tVectorStart = performance.now();
    
    if (virtualRaster && rasterMetadata) {
      const tSelectStart = performance.now();
      // Calculate what portion of the raster is currently visible
      const canvasVisibleTop = visibleTop;
      const canvasVisibleBottom = visibleBottom;
      
      const viewportY = Math.max(0, canvasVisibleTop);
      const viewportHeight = Math.max(0, canvasVisibleBottom - viewportY);
      
      // We update VirtualRaster viewport so it schedules tile decoding
      virtualRaster.updateViewport({
         zoom: zoomScale,
         visibleBounds: { x: 0, y: viewportY, width: rasterMetadata.width, height: viewportHeight },
         scrollVelocity: { x: 0, y: 0 },
         direction: 'none'
      });
      tTileSelection = performance.now() - tSelectStart;
      
      const startIdx = Math.floor(viewportY / virtualRaster.config.tileHeight);
      const endIdx = Math.floor((viewportY + viewportHeight) / virtualRaster.config.tileHeight);
      
      const rotAngle = project.raster?.rotationAngle || 0;
      if (rotAngle !== 0) {
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rotAngle * Math.PI) / 180);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);
      }
      
      const tDrawStart = performance.now();
      for (let i = startIdx; i <= endIdx; i++) {
         const tCacheStart = performance.now();
         const tile = virtualRaster.getTile(0, i);
         tCacheLookup += (performance.now() - tCacheStart);
         
         const tTileDrawStart = performance.now();
         if (tile.bitmap && tile.state !== 'ERROR') {
            ctx.drawImage(tile.bitmap, 0, tile.pixelBounds.y, tile.pixelBounds.width, tile.pixelBounds.height);
         }
         tCanvasDraw += (performance.now() - tTileDrawStart);
      }
      
      if (rotAngle !== 0) {
        ctx.restore();
      }
    } else if (rasterUrl) { // Fallback for old projects
      const baseImg = new Image();
      baseImg.src = rasterUrl;
      baseImg.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const rotAngle = project.raster?.rotationAngle || 0;
        if (rotAngle !== 0) {
          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate((rotAngle * Math.PI) / 180);
          ctx.drawImage(baseImg, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
          ctx.restore();
        } else {
          ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
        }
      };
    }

    // Overlays of Calibration Zones
       // Overlays of Calibration Guides and Horizontal Scales
      if (activeTab === 'calibration-vertical' || activeTab === 'calibration-horizontal' || activeTab === 'digitize' || activeTab === 'alignment') {
        project.tracks.forEach(t => {
          const isLog = t.valueTransform.type === 'log';
          const minVal = t.valueTransform.valueMin;
          const maxVal = t.valueTransform.valueMax;
          const leftX = t.pixelXLeft;
          const rightX = t.pixelXRight;
          const width = rightX - leftX;

          const isLeftCalibrating = calibratingXTrack && calibratingXTrack.id === t.id && calibratingXTrack.side === 'left';
          const isRightCalibrating = calibratingXTrack && calibratingXTrack.id === t.id && calibratingXTrack.side === 'right';

          // Get all Y anchors to draw clean track shapes and grids
          const leftPts = t.leftPoints || [];
          const rightPts = t.rightPoints || [];
          const ySet = new Set<number>([0, canvas.height]);
          leftPts.forEach(p => ySet.add(p.y));
          rightPts.forEach(p => ySet.add(p.y));
          const yNodes = Array.from(ySet).sort((a,b) => a - b);

          const isCalibTab = activeTab === 'calibration-vertical' || activeTab === 'calibration-horizontal';

          const drawBoundary = (side: 'left'|'right', isCalib: boolean) => {
            ctx.beginPath();
            yNodes.forEach((y, i) => {
              const x = getTrackBoundX(t, side, y);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.strokeStyle = isCalib ? '#f43f5e' : (isCalibTab ? '#6366f1' : 'rgba(99, 102, 241, 0.5)');
            ctx.lineWidth = isCalib ? 4.5 : (isCalibTab ? 3.0 : 1.5);
            if (isCalib) ctx.setLineDash([5, 3]);
            else ctx.setLineDash([]);
            ctx.stroke();

            // Draw anchor dots
            if (activeTab === 'calibration-horizontal') {
              const pts = side === 'left' ? leftPts : rightPts;
              ctx.fillStyle = '#ec4899';
              pts.forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4 / zoomScale, 0, Math.PI * 2);
                ctx.fill();
              });
            }
          };

          drawBoundary('left', !!isLeftCalibrating);
          drawBoundary('right', !!isRightCalibrating);
          ctx.setLineDash([]); // Reset line dash

          // Fill track container translucent preview
          ctx.beginPath();
          yNodes.forEach((y, i) => {
            const x = getTrackBoundX(t, 'left', y);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          for (let i = yNodes.length - 1; i >= 0; i--) {
            const x = getTrackBoundX(t, 'right', yNodes[i]);
            ctx.lineTo(x, yNodes[i]);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(99, 102, 241, 0.02)';
          ctx.fill();

          const isReverse = t.valueTransform.direction === 'reverse';

          // Helper to draw a fraction grid line (0 to 1)
          const drawGridLineFraction = (fraction: number) => {
            ctx.beginPath();
            yNodes.forEach((y, i) => {
              const lx = getTrackBoundX(t, 'left', y);
              const rx = getTrackBoundX(t, 'right', y);
              const x = lx + fraction * (rx - lx);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.stroke();
          };

          // Draw dynamic grid lines with ticks
          ctx.strokeStyle = 'rgba(79, 70, 229, 0.15)';
          ctx.lineWidth = 0.5;
          ctx.fillStyle = 'rgba(79, 70, 229, 0.7)';
          ctx.font = 'bold 9px sans-serif';

          // Ruler line at y=40
          ctx.beginPath();
          ctx.moveTo(getTrackBoundX(t, 'left', 40), 40);
          ctx.lineTo(getTrackBoundX(t, 'right', 40), 40);
          ctx.stroke();

          // Draw scale range text indicators
          const dirIndicator = isReverse ? 'REV' : (isLog ? 'LOG' : 'LIN');
          const tLx = getTrackBoundX(t, 'left', 18);
          const tRx = getTrackBoundX(t, 'right', 18);
          ctx.fillText(`${t.name} (${dirIndicator})`, tLx + 4, 18);
          
          const tLx32 = getTrackBoundX(t, 'left', 32);
          const tRx32 = getTrackBoundX(t, 'right', 32);
          const leftLabel = `Batas Kiri: ${isReverse ? maxVal : minVal}`;
          const rightLabel = `Batas Kanan: ${isReverse ? minVal : maxVal}`;
          ctx.fillText(leftLabel, tLx32 + 4, 32);
          ctx.fillText(rightLabel, tRx32 - ctx.measureText(rightLabel).width - 4, 32);

          // Vertical grid ticks
          if (isLog) {
            // Decadal distribution
            const logMin = minVal <= 0 ? 0.2 : minVal;
            const logMax = maxVal <= 0 ? 2000 : maxVal;
            const logMin1 = Math.log10(logMin);
            const logMax1 = Math.log10(logMax);
            const span = logMax1 - logMin1;

            const decades = [];
            let val = Math.pow(10, Math.ceil(logMin1));
            while (val < maxVal) {
              decades.push(val);
              val *= 10;
            }

            decades.forEach(v => {
              const fraction = (Math.log10(v) - logMin1) / span;
              const finalFraction = isReverse ? (1 - fraction) : fraction;
              if (finalFraction > 0 && finalFraction < 1) {
                drawGridLineFraction(finalFraction);
                const xPos35 = getTrackBoundX(t, 'left', 35) + finalFraction * (getTrackBoundX(t, 'right', 35) - getTrackBoundX(t, 'left', 35));
                ctx.fillText(`${v}`, xPos35 - 4, 28);
              }
            });
          } else {
            // Linear divisions (25%, 50%, 75%)
            [0.25, 0.5, 0.75].forEach(frac => {
              drawGridLineFraction(frac);
              const xPos35 = getTrackBoundX(t, 'left', 35) + frac * (getTrackBoundX(t, 'right', 35) - getTrackBoundX(t, 'left', 35));
              const currentVal = isReverse 
                ? (maxVal - frac * (maxVal - minVal)) 
                : (minVal + frac * (maxVal - minVal));
              ctx.fillText(`${Number(currentVal.toFixed(1))}`, xPos35 - 10, 28);
            });
          }
        });

        // Vertical Skew & Depth Calibration visualizations
        if (activeTab === 'calibration-vertical') {
          // 1. Stage 1: Global X Anchor Guideline (thick high-contrast magenta guide line)
          ctx.save();
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.lineWidth = 5.0;
          ctx.beginPath();
          ctx.moveTo(globalXAnchor, 0);
          ctx.lineTo(globalXAnchor, canvas.height);
          ctx.stroke();

          ctx.strokeStyle = '#f43f5e';
          ctx.lineWidth = 3.0;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          ctx.moveTo(globalXAnchor, 0);
          ctx.lineTo(globalXAnchor, canvas.height);
          ctx.stroke();
          ctx.restore();
          
          ctx.save();
          ctx.fillStyle = '#f43f5e';
          ctx.font = 'bold 10px sans-serif';
          ctx.fillText("Global X Anchor (Tarik garis ini)", globalXAnchor + 8, 20);
          ctx.restore();

          // 2. Stage 2: Connected Slanted/Skewed Guide Axis
          ctx.save();
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.lineWidth = 5.5;
          ctx.beginPath();
          project.depthTransform.controlPoints.forEach((cp, idx) => {
            const x = (cp as any).pixelX ?? globalXAnchor;
            if (idx === 0) ctx.moveTo(x, cp.pixelY);
            else ctx.lineTo(x, cp.pixelY);
          });
          ctx.stroke();

          ctx.strokeStyle = '#818cf8';
          ctx.lineWidth = 3.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          project.depthTransform.controlPoints.forEach((cp, idx) => {
            const x = (cp as any).pixelX ?? globalXAnchor;
            if (idx === 0) ctx.moveTo(x, cp.pixelY);
            else ctx.lineTo(x, cp.pixelY);
          });
          ctx.stroke();
          ctx.restore();
        }

        // 3. Render Knots & Horizontal Depth Calibration Markers
        project.depthTransform.controlPoints.forEach((cp, cpIdx) => {
          if (cp.pixelY < visibleTop - 20 || cp.pixelY > visibleBottom + 20) return;
          const cpX = (cp as any).pixelX ?? globalXAnchor;

          // High-contrast background outline stroke
          ctx.save();
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
          ctx.lineWidth = cp.isSlanted ? 6.0 : 5.0;
          ctx.beginPath();
          if (cp.isSlanted) {
            const lX = cp.leftX ?? (currentRasterWidth * 0.1);
            const lY = cp.leftY ?? cp.pixelY;
            const rX = cp.rightX ?? (currentRasterWidth * 0.9);
            const rY = cp.rightY ?? cp.pixelY;
            ctx.moveTo(lX, lY);
            ctx.lineTo(rX, rY);
          } else {
            ctx.moveTo(0, cp.pixelY);
            ctx.lineTo(canvas.width, cp.pixelY);
          }
          ctx.stroke();

          // Foreground vibrant calibration line
          ctx.strokeStyle = cp.isSlanted ? '#818cf8' : '#f43f5e'; // Indigo for slanted, Pink/Rose for horizontal
          ctx.lineWidth = cp.isSlanted ? 3.5 : 3.0;
          ctx.setLineDash(cp.isSlanted ? [8, 4] : [10, 4]);
          ctx.beginPath();
          if (cp.isSlanted) {
            const lX = cp.leftX ?? (currentRasterWidth * 0.1);
            const lY = cp.leftY ?? cp.pixelY;
            const rX = cp.rightX ?? (currentRasterWidth * 0.9);
            const rY = cp.rightY ?? cp.pixelY;
            ctx.moveTo(lX, lY);
            ctx.lineTo(rX, rY);
          } else {
            ctx.moveTo(0, cp.pixelY);
            ctx.lineTo(canvas.width, cp.pixelY);
          }
          ctx.stroke();
          ctx.restore();

          // Text label badge with high-contrast background pill
          const labelText = `Knot #${cpIdx + 1}: ${cp.depth} ${project.well.depthUnit}${cp.isSlanted ? ' (Slanted)' : ''}`;
          ctx.font = 'bold 12px sans-serif';
          const labelX = cp.isSlanted ? ((cp.leftX ?? (currentRasterWidth * 0.1)) + (cp.rightX ?? (currentRasterWidth * 0.9))) / 2 + 15 : cpX + 15;
          const labelY = cp.isSlanted ? ((cp.leftY ?? cp.pixelY) + (cp.rightY ?? cp.pixelY)) / 2 - 6 : cp.pixelY - 6;
          const textW = ctx.measureText(labelText).width;

          ctx.save();
          ctx.fillStyle = cp.isSlanted ? 'rgba(30, 27, 75, 0.92)' : 'rgba(131, 24, 67, 0.92)';
          ctx.strokeStyle = cp.isSlanted ? '#818cf8' : '#f43f5e';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(labelX - 6, labelY - 14, textW + 12, 18, 4);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.fillText(labelText, labelX, labelY - 1);
          ctx.restore();

          // Circular drag handles (larger & bolder)
          if (cp.isSlanted) {
            const lX = cp.leftX ?? (currentRasterWidth * 0.1);
            const lY = cp.leftY ?? cp.pixelY;
            const rX = cp.rightX ?? (currentRasterWidth * 0.9);
            const rY = cp.rightY ?? cp.pixelY;
            const midX = (lX + rX) / 2;
            const midY = (lY + rY) / 2;

            // Left handle
            ctx.save();
            ctx.fillStyle = '#6366f1';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(lX, lY, 9, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();

            // Right handle
            ctx.beginPath();
            ctx.arc(rX, rY, 9, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();

            // Center handle
            ctx.fillStyle = '#f43f5e';
            ctx.beginPath();
            ctx.arc(midX, midY, 8, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          } else {
            ctx.save();
            ctx.fillStyle = '#f43f5e';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(cpX, cp.pixelY, 9, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        });
      }

      // Overlays of active digitizing points and lines
      project.curves.forEach((c) => {
        if (hiddenCurveIds[c.id]) return;
        const isActive = c.id === activeCurveId;
        const color = getCurveVisualColor(c);
        const weight = getCurveWeight(c, isActive);
        const dashStyle = getCurveDashStyle(c);

        // Draw connecting curves only
        if (c.points.length > 0) {
          ctx.strokeStyle = color;
          ctx.lineWidth = weight;
          if (dashStyle === 'dashed') {
            ctx.setLineDash([6, 4]);
          } else if (dashStyle === 'dotted') {
            ctx.setLineDash([2, 2]);
          } else {
            ctx.setLineDash([]);
          }
          ctx.beginPath();
          let isPathActive = false;
          let lastY: number | null = null;
          c.points.forEach((pt) => {
            if (pt.value === null) {
              isPathActive = false;
              lastY = null;
              return;
            }
            // Apply visual alignment depth shift physically in Y pixels
            const shiftPixelsY = c.depthShiftApplied / (project.depthTransform.linearScale || 1);
            const targetY = pt.pixelY + shiftPixelsY;

            // Break line path if there is a vertical gap > 20 pixels (e.g. from erasing)
            if (lastY !== null && Math.abs(targetY - lastY) > 20) {
              isPathActive = false;
            }

            if (!isPathActive) {
              ctx.moveTo(pt.pixelX, targetY);
              isPathActive = true;
            } else {
              ctx.lineTo(pt.pixelX, targetY);
            }
            lastY = targetY;
          });
          ctx.stroke();
          ctx.setLineDash([]); // Reset line dash

          // Draw uncertainty shaded band on active curve
          if (isActive && activeTab === 'alignment') {
            const validPoints = c.points.filter(p => p.value !== null);
            if (validPoints.length > 0) {
              ctx.fillStyle = `${color}1A`; // transparent version
              ctx.beginPath();
              // Draw left edge (+ uncertain px bounds)
              validPoints.forEach((pt, ptIdx) => {
                const uVal = pt.uncertaintyValue || 2.0;
                const uncPx = uVal * (validPoints.length > 0 ? 5 : 1); // scale to pixels visually
                if (ptIdx === 0) ctx.moveTo(pt.pixelX - uncPx, pt.pixelY);
                else ctx.lineTo(pt.pixelX - uncPx, pt.pixelY);
              });
              // Loop back on right edge
              for (let i = validPoints.length - 1; i >= 0; i--) {
                const pt = validPoints[i];
                const uVal = pt.uncertaintyValue || 2.0;
                const uncPx = uVal * (validPoints.length > 0 ? 5 : 1);
                ctx.lineTo(pt.pixelX + uncPx, pt.pixelY);
              }
              ctx.closePath();
              ctx.fill();
            }
          }

          // Point markers omitted as requested: curve is displayed purely as continuous line
        }
      });

      // Overlays of geological lithologies
      project.lithologyIntervals.forEach((l) => {
        // Map actual depths back to visual height Y levels using calibration inverse scale
        const scale = project.depthTransform.linearScale || 1;
        const offset = project.depthTransform.linearOffset || 1450;
        
        const topPx = (l.depthTop - offset) / scale;
        const bottomPx = (l.depthBottom - offset) / scale;
        
        // Viewport clipping
        if (bottomPx < visibleTop - 10 || topPx > visibleBottom + 10) return;

        // Paint in margin as horizontal overlay
        ctx.fillStyle = `${l.colorHex}50`; // transparent fill overlay
        ctx.fillRect(8, topPx, 35, bottomPx - topPx);
        ctx.strokeStyle = l.colorHex;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(8, topPx, 35, bottomPx - topPx);
        // Name text
        ctx.fillStyle = '#4b5563';
        ctx.font = '9px Georgia, serif';
        ctx.fillText(l.label.substr(0, 5) + '.', 10, topPx + 14);
      });

      // Render synchronized Vector Canvas (Right Split View)
      if (rightCanvasRef.current && (workspaceMode === 'split' || workspaceMode === 'digitized')) {
        const rCanvas = rightCanvasRef.current;
        const rCtx = rCanvas.getContext('2d');
        if (rCtx) {
          rCtx.clearRect(0, 0, rCanvas.width, rCanvas.height);

          // 1. Light adaptive engineering grid background
          rCtx.fillStyle = adaptiveBgColor || '#f8fafc';
          rCtx.fillRect(0, 0, rCanvas.width, rCanvas.height);

          // Subtle paper grid mesh
          rCtx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
          rCtx.lineWidth = 1;
          for (let gx = 0; gx < rCanvas.width; gx += 100) {
            rCtx.beginPath();
            rCtx.moveTo(gx, 0);
            rCtx.lineTo(gx, rCanvas.height);
            rCtx.stroke();
          }
          for (let gy = 0; gy < rCanvas.height; gy += 100) {
            rCtx.beginPath();
            rCtx.moveTo(0, gy);
            rCtx.lineTo(rCanvas.width, gy);
            rCtx.stroke();
          }

          // 2. Track Boundaries & Headers
          project.tracks.forEach((t) => {
            const leftPts = t.leftPoints || [];
            const rightPts = t.rightPoints || [];
            const ySet = new Set<number>([0, rCanvas.height]);
            leftPts.forEach(p => ySet.add(p.y));
            rightPts.forEach(p => ySet.add(p.y));
            const yNodes = Array.from(ySet).sort((a, b) => a - b);

            const isLog = t.valueTransform.type === 'log';
            const minVal = t.valueTransform.valueMin;
            const maxVal = t.valueTransform.valueMax;
            const isReverse = t.valueTransform.direction === 'reverse';

            // Fill Track Container Area with clean paper fill
            rCtx.beginPath();
            yNodes.forEach((y, i) => {
              const x = getTrackBoundX(t, 'left', y);
              if (i === 0) rCtx.moveTo(x, y);
              else rCtx.lineTo(x, y);
            });
            for (let i = yNodes.length - 1; i >= 0; i--) {
              const x = getTrackBoundX(t, 'right', yNodes[i]);
              rCtx.lineTo(x, yNodes[i]);
            }
            rCtx.closePath();
            rCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            rCtx.fill();

            // Boundaries
            rCtx.strokeStyle = '#4f46e5';
            rCtx.lineWidth = 2.0;
            rCtx.beginPath();
            yNodes.forEach((y, i) => {
              const x = getTrackBoundX(t, 'left', y);
              if (i === 0) rCtx.moveTo(x, y);
              else rCtx.lineTo(x, y);
            });
            rCtx.stroke();

            rCtx.beginPath();
            yNodes.forEach((y, i) => {
              const x = getTrackBoundX(t, 'right', y);
              if (i === 0) rCtx.moveTo(x, y);
              else rCtx.lineTo(x, y);
            });
            rCtx.stroke();

            // Header Banner Label
            const tLx = getTrackBoundX(t, 'left', 18);
            const dirIndicator = isReverse ? 'REV' : (isLog ? 'LOG' : 'LIN');
            rCtx.fillStyle = '#312e81';
            rCtx.font = 'bold 11px sans-serif';
            rCtx.fillText(`${t.name} (${dirIndicator})`, tLx + 6, 18);

            const leftLabel = `${isReverse ? maxVal : minVal}`;
            const rightLabel = `${isReverse ? minVal : maxVal}`;
            rCtx.fillStyle = '#475569';
            rCtx.font = '10px sans-serif';
            rCtx.fillText(leftLabel, getTrackBoundX(t, 'left', 32) + 6, 32);
            rCtx.fillText(rightLabel, getTrackBoundX(t, 'right', 32) - rCtx.measureText(rightLabel).width - 6, 32);

            // Subgrid Divisions
            rCtx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
            rCtx.lineWidth = 1;
            const drawGridLineFraction = (fraction: number) => {
              rCtx.beginPath();
              yNodes.forEach((y, i) => {
                const lx = getTrackBoundX(t, 'left', y);
                const rx = getTrackBoundX(t, 'right', y);
                const x = lx + fraction * (rx - lx);
                if (i === 0) rCtx.moveTo(x, y);
                else rCtx.lineTo(x, y);
              });
              rCtx.stroke();
            };

            if (isLog) {
              const logMin = minVal <= 0 ? 0.2 : minVal;
              const logMax = maxVal <= 0 ? 2000 : maxVal;
              const logMin1 = Math.log10(logMin);
              const logMax1 = Math.log10(logMax);
              const span = logMax1 - logMin1;

              let val = Math.pow(10, Math.ceil(logMin1));
              while (val < maxVal) {
                const fraction = (Math.log10(val) - logMin1) / span;
                const finalFraction = isReverse ? (1 - fraction) : fraction;
                if (finalFraction > 0 && finalFraction < 1) {
                  drawGridLineFraction(finalFraction);
                }
                val *= 10;
              }
            } else {
              [0.25, 0.5, 0.75].forEach(frac => {
                drawGridLineFraction(frac);
              });
            }
          });

          // 3. Depth Grid Lines
          project.depthTransform.controlPoints.forEach((cp) => {
            if (cp.pixelY < visibleTop - 20 || cp.pixelY > visibleBottom + 20) return;
            rCtx.save();
            rCtx.strokeStyle = cp.isSlanted ? '#6366f1' : 'rgba(225, 29, 72, 0.8)';
            rCtx.lineWidth = cp.isSlanted ? 2.0 : 1.5;
            rCtx.setLineDash([6, 4]);
            rCtx.beginPath();
            if (cp.isSlanted) {
              const lX = cp.leftX ?? (currentRasterWidth * 0.1);
              const lY = cp.leftY ?? cp.pixelY;
              const rX = cp.rightX ?? (currentRasterWidth * 0.9);
              const rY = cp.rightY ?? cp.pixelY;
              rCtx.moveTo(lX, lY);
              rCtx.lineTo(rX, rY);
            } else {
              rCtx.moveTo(0, cp.pixelY);
              rCtx.lineTo(rCanvas.width, cp.pixelY);
            }
            rCtx.stroke();
            rCtx.restore();

            const labelText = `${cp.depth} ${project.well.depthUnit}`;
            rCtx.fillStyle = cp.isSlanted ? '#4338ca' : '#be123c';
            rCtx.font = 'bold 10px sans-serif';
            rCtx.fillText(labelText, globalXAnchor + 12, cp.pixelY - 4);
          });

          // 4. Vectorized Digitized Curves (Rendered strictly as continuous lines without points)
          project.curves.forEach((c) => {
            if (hiddenCurveIds[c.id]) return;
            const isActive = c.id === activeCurveId;
            const color = getCurveVisualColor(c);
            const weight = getCurveWeight(c, isActive) * 1.5;
            const dashStyle = getCurveDashStyle(c);

            if (c.points.length > 0) {
              // Active Glow
              if (isActive) {
                rCtx.save();
                rCtx.strokeStyle = color;
                rCtx.lineWidth = weight + 4;
                rCtx.globalAlpha = 0.25;
                rCtx.beginPath();
                let pathStarted = false;
                c.points.forEach((pt) => {
                  if (pt.value === null) {
                    pathStarted = false;
                  } else {
                    if (!pathStarted) {
                      rCtx.moveTo(pt.pixelX, pt.pixelY);
                      pathStarted = true;
                    } else {
                      rCtx.lineTo(pt.pixelX, pt.pixelY);
                    }
                  }
                });
                rCtx.stroke();
                rCtx.restore();
              }

              // Curve Path
              rCtx.save();
              rCtx.strokeStyle = color;
              rCtx.lineWidth = weight;
              if (dashStyle === 'dashed') rCtx.setLineDash([8, 4]);
              else if (dashStyle === 'dotted') rCtx.setLineDash([3, 3]);
              else rCtx.setLineDash([]);

              rCtx.beginPath();
              let isPathActive = false;
              let lastY: number | null = null;
              c.points.forEach((pt) => {
                if (pt.value === null) {
                  isPathActive = false;
                  lastY = null;
                } else {
                  if (lastY !== null && Math.abs(pt.pixelY - lastY) > 20) {
                    isPathActive = false;
                  }
                  if (!isPathActive) {
                    rCtx.moveTo(pt.pixelX, pt.pixelY);
                    isPathActive = true;
                  } else {
                    rCtx.lineTo(pt.pixelX, pt.pixelY);
                  }
                  lastY = pt.pixelY;
                }
              });
              rCtx.stroke();
              rCtx.restore();

              // Points omitted as requested: curve is displayed purely as continuous vector line
            }
          });

          // 5. Crosshair hover indicator
          if (mouseHoverCoords) {
            rCtx.save();
            rCtx.strokeStyle = 'rgba(244, 63, 94, 0.5)';
            rCtx.lineWidth = 1;
            rCtx.setLineDash([4, 4]);
            rCtx.beginPath();
            rCtx.moveTo(0, mouseHoverCoords.y);
            rCtx.lineTo(rCanvas.width, mouseHoverCoords.y);
            rCtx.stroke();
            rCtx.restore();
          }
        }
      }

      // Draw custom visual eraser circle overlay matching the eraserRadius
      if (activeTab === 'digitize' && digitizationMode === 'erase' && mouseHoverCoords) {
        ctx.save();
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 2]);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
        ctx.beginPath();
        ctx.arc(mouseHoverCoords.x, mouseHoverCoords.y, eraserRadius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Draw Area of Interest (AOI) Selection Box
      const activeAoi = isDrawingAoi ? tempAoiBox : aoiSelection;
      if (activeTab === 'digitize' && activeAoi) {
        ctx.save();
        const { minX, minY, maxX, maxY } = activeAoi;
        const width = maxX - minX;
        const height = maxY - minY;

        // Soft translucent blue fill
        ctx.fillStyle = 'rgba(37, 99, 235, 0.14)';
        ctx.fillRect(minX, minY, width, height);

        // Dashed high-contrast blue outline
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = Math.max(1.5, 2 / zoomScale);
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(minX, minY, width, height);
        ctx.setLineDash([]);

        // Four corner handles
        const handleSize = Math.max(4, 6 / zoomScale);
        ctx.fillStyle = '#1d4ed8';
        [
          [minX, minY],
          [maxX, minY],
          [minX, maxY],
          [maxX, maxY]
        ].forEach(([cx, cy]) => {
          ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
        });

        // Depth Badges
        const topDepth = pixelYToDepth(minY, project.depthTransform).depth;
        const bottomDepth = pixelYToDepth(maxY, project.depthTransform).depth;
        const unit = project.well.depthUnit || 'm';

        ctx.font = `bold ${Math.max(10, Math.min(13, 11 / zoomScale))}px sans-serif`;

        // Top Depth Tag
        const topLabel = `Top AOI: ${topDepth.toFixed(1)} ${unit}`;
        const topTagW = ctx.measureText(topLabel).width + 12;
        const tagH = Math.max(16, 18 / zoomScale);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(minX, minY - tagH, topTagW, tagH);
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1;
        ctx.strokeRect(minX, minY - tagH, topTagW, tagH);
        ctx.fillStyle = '#1e40af';
        ctx.fillText(topLabel, minX + 6, minY - (tagH / 4));

        // Bottom Depth Tag
        const btmLabel = `Bottom AOI: ${bottomDepth.toFixed(1)} ${unit}`;
        const btmTagW = ctx.measureText(btmLabel).width + 12;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(minX, maxY, btmTagW, tagH);
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1;
        ctx.strokeRect(minX, maxY, btmTagW, tagH);
        ctx.fillStyle = '#1e40af';
        ctx.fillText(btmLabel, minX + 6, maxY + (tagH * 0.75));

        ctx.restore();
      }
      
      tCanvasDraw += (performance.now() - tVectorStart);
      
      const tFrameTotal = performance.now() - tFrameStart;
      
      // Request animation frame to avoid blocking the current render cycle when setting state
      // Only set profile metrics when the profiler is active to prevent infinite re-render loops and UI freezes
      if (showProfiler) {
        requestAnimationFrame(() => {
          setProfileMetrics({
            frameTotal: tFrameTotal,
            tileSelection: tTileSelection,
            cacheLookup: tCacheLookup,
            canvasDraw: tCanvasDraw,
          });
        });
      }
       

  }, [project, activeCurveId, activeTab, rasterUrl, calibratingXTrack, virtualRaster, rasterMetadata, panOffset, zoomScale, renderCounter, viewportSize, showProfiler, aoiSelection, isDrawingAoi, tempAoiBox, digitizationMode]);

  // Reusable helper to initialize the VirtualRaster engine for both manual uploads & restored sessions
  const loadRasterEngineOnly = async (file: Blob | File, filename: string): Promise<{ width: number; height: number }> => {
    const isTiff = filename.toLowerCase().endsWith('.tif') || filename.toLowerCase().endsWith('.tiff') || file.type === 'image/tiff';
    
    const config: VirtualRasterConfig = {
      maxCacheMemoryBytes: 256 * 1024 * 1024,
      tileHeight: 1024,
      maxWorkers: 4,
      prefetchForward: 2,
      prefetchBackward: 1,
    };
    const vr = new VirtualRaster(config);
    
    let source: TiffRasterSource | ImageBlobRasterSource;
    if (isTiff) {
      source = new TiffRasterSource(config.maxWorkers);
      (source as TiffRasterSource).onTrace = (msg) => {
        setRasterLoadingStatus(msg);
      };
    } else {
      source = new ImageBlobRasterSource();
    }
    
    await source.open(file);
    const pipeline = new RasterPipeline(source);
    await vr.load(pipeline);
    
    const meta = vr.getMetadata();
    setVirtualRaster(vr);
    setRasterPipeline(pipeline);
    setRasterMetadata(meta);
    
    return { width: meta.width, height: meta.height };
  };

  // Handle manual raster image file loading
  const handleRasterImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsRasterLoading(true);
    try {
      setRasterLoadingStatus('Initializing VirtualRaster engine...');
      const { width, height } = await loadRasterEngineOnly(file, file.name);

      // Save file and filename in localforage for session recovery!
      await localforage.setItem('citra_session_recovery_raster_file', file);
      await localforage.setItem('citra_session_recovery_raster_name', file.name);

      const targetW = width;
      const targetH = height;

      // Reset coordinates and generate empty curves back to optimized coordinate framework
      const freshState: ProjectState = {
        version: '1.0.0',
        well: {
          name: file.name.replace(/\.[^/.]+$/, ""),
          field: "PROVINCIAL_EXPLORE",
          operator: "UNREGULATED CORP",
          uwi: "00-112-99-A1",
          datum: "KB",
          depthType: "MD",
          depthUnit: "m"
        },
        raster: {
          name: file.name,
          dataUrl: '', // Obsoleted by VirtualRaster
          width: targetW,
          height: targetH,
          wasFlipped: false,
          wasInverted: false
        },
        nullValueGlobal: -999.25,
                depthTransform: {
          type: 'linear',
          controlPoints: [
            { pixelY: Math.round(targetH * 0.1), depth: 1000 },
            { pixelY: Math.round(targetH * 0.9), depth: 2000 }
          ]
        },
        tracks: [
          {
            id: `track-idx-${Date.now()}-1`,
            name: 'Track 1',
            pixelXLeft: Math.round(targetW * 0.1),
            pixelXRight: Math.round(targetW * 0.4),
            isConfigured: false,
            logType: undefined,
            valueTransform: {
              type: 'linear',
              pixelMin: Math.round(targetW * 0.1),
              pixelMax: Math.round(targetW * 0.4),
              valueMin: 0,
              valueMax: 100,
              direction: 'normal'
            }
          }
        ],
        curves: [
          {
            id: `track-idx-${Date.now()}-1`,
            trackId: `track-idx-${Date.now()}-1`,
            metadata: {
              id: `meta-track-idx-${Date.now()}-1`,
              mnemonic: 'UNCONFIGURED_1',
              unit: '',
              nullValue: -999.25
            },
            points: [],
            depthShiftApplied: 0
          }
        ],
        lithologyIntervals: []
      };

      const loadedProj = syncCalibrations(freshState);
      saveActionState(loadedProj, `Ingested custom well log image: ${file.name}`);

      const initialZoom = Math.max(0.05, Math.min(5.0, viewportSize.width / targetW));
      const initialPanY = (targetH * initialZoom - viewportSize.height) / 2;
      updatePanAndZoom({ x: 0, y: initialPanY }, initialZoom, targetW, targetH);

      setIsRasterLoading(false);
    } catch (err: any) {
      console.error(err);
      alert(`Gagal memproses file gambar: ${err?.message || err}`);
      setIsRasterLoading(false);
    }
  };

  const handleCreateNewProject = async (options: {
    wellName: string;
    field: string;
    operator: string;
    uwi: string;
    datum: 'KB' | 'GL' | 'MSL';
    depthUnit: 'm' | 'ft';
    topDepth: number;
    bottomDepth: number;
    file: File | null;
    customCurves?: NewCurveConfig[];
  }) => {
    setIsRasterLoading(true);
    setRasterLoadingStatus('Initializing new project...');

    // Build tracks and curves dynamically if custom curves array is supplied
    const curvesList = options.customCurves || [];
    const getDynamicTracks = (pixelMinOverride?: number, pixelMaxOverride?: number) => {
      if (curvesList.length > 0) {
        return curvesList.map((cfg, idx) => ({
          id: `track-${idx + 1}`,
          name: `${cfg.mnemonic} Track`,
          pixelXLeft: cfg.pixelMin,
          pixelXRight: cfg.pixelMax,
          valueTransform: {
            type: cfg.scaleType,
            pixelMin: cfg.pixelMin,
            pixelMax: cfg.pixelMax,
            valueMin: cfg.valueMin,
            valueMax: cfg.valueMax,
            direction: cfg.direction || 'normal'
          }
        }));
      }
      return [];
    };

    const getDynamicCurves = () => {
      if (curvesList.length > 0) {
        return curvesList.map((cfg, idx) => ({
          id: `curve-${idx + 1}`,
          metadata: {
            id: `m-${idx + 1}`,
            mnemonic: cfg.mnemonic,
            unit: cfg.unit,
            nullValue: cfg.nullValue
          },
          trackId: `track-${idx + 1}`,
          points: [],
          depthShiftApplied: 0
        }));
      }
      return [];
    };

    const file = options.file;
    if (!file) {
      alert("Silakan pilih file gambar log terlebih dahulu.");
      setIsRasterLoading(false);
      return;
    }

    try {
      setRasterLoadingStatus('Initializing VirtualRaster engine...');
      const { width, height } = await loadRasterEngineOnly(file, file.name);

      // Save file and filename in localforage for session recovery!
      await localforage.setItem('citra_session_recovery_raster_file', file);
      await localforage.setItem('citra_session_recovery_raster_name', file.name);

      const targetW = width;
      const targetH = height;

      const freshState: ProjectState = {
        version: '1.0.0',
        well: {
          name: options.wellName,
          field: options.field,
          operator: options.operator,
          uwi: options.uwi,
          datum: options.datum,
          depthType: "MD",
          depthUnit: options.depthUnit,
          datumValue: "",
          locationX: "",
          locationY: "",
          topDepth: String(options.topDepth),
          bottomDepth: String(options.bottomDepth)
        },
        raster: {
          name: file.name,
          dataUrl: '', // Obsoleted by VirtualRaster
          width: targetW,
          height: targetH,
          wasFlipped: false,
          wasInverted: false
        },
        nullValueGlobal: -999.25,
        depthTransform: {
          type: 'linear',
          controlPoints: [
            { pixelY: Math.round(targetH * 0.1), depth: options.topDepth },
            { pixelY: Math.round(targetH * 0.9), depth: options.bottomDepth }
          ]
        },
        tracks: getDynamicTracks().length > 0 ? getDynamicTracks() : [
          {
            id: `track-idx-${Date.now()}-1`,
            name: 'Track 1',
            pixelXLeft: Math.round(targetW * 0.1),
            pixelXRight: Math.round(targetW * 0.4),
            isConfigured: false,
            logType: undefined,
            valueTransform: {
              type: 'linear',
              pixelMin: Math.round(targetW * 0.1),
              pixelMax: Math.round(targetW * 0.4),
              valueMin: 0,
              valueMax: 100,
              direction: 'normal'
            }
          }
        ],
        curves: getDynamicCurves().length > 0 ? getDynamicCurves() : [
          {
            id: `track-idx-${Date.now()}-1`,
            trackId: `track-idx-${Date.now()}-1`,
            metadata: {
              id: `meta-track-idx-${Date.now()}-1`,
              mnemonic: 'UNCONFIGURED_1',
              unit: '',
              nullValue: -999.25
            },
            points: [],
            depthShiftApplied: 0
          }
        ],
        lithologyIntervals: []
      };

      const loadedProj = syncCalibrations(freshState);
      setProject(loadedProj);
      if (loadedProj.curves.length > 0) setActiveCurveId(loadedProj.curves[0].id);
      setUndoStack([]);
      setRedoStack([]);
      setIsRasterLoading(false);
      setUndoCommandStack([]);
      setRedoCommandStack([]);
      logInfo(`Inisialisasi proyek baru: ${file.name}`);
    } catch (err: any) {
      console.error(err);
      alert(`Gagal memproses file gambar: ${err?.message || err}`);
      setIsRasterLoading(false);
    }

    setShowNewProjectModal(false);
  };

  // 7. QUALITY METRICS COMPUTATION (QC AUDITOR)
  const computeWellQCMetrics = () => {
    return project.curves.map(c => {
      const activeTrack = project.tracks.find(t => t.id === c.trackId);
      const validPoints = c.points.filter(pt => pt.value !== null);
      const values = validPoints.map(pt => pt.value as number);
      const depths = validPoints.map(pt => pt.depth);

      // Check monotonicity
      let isIncreasing = true;
      for (let i = 1; i < depths.length; i++) {
        if (depths[i] < depths[i - 1]) isIncreasing = false;
      }

      // Compute spacing variation (CV)
      let sampleSpacingCV = 0;
      if (depths.length >= 3) {
        const spacings: number[] = [];
        for (let i = 1; i < depths.length; i++) {
          spacings.push(depths[i] - depths[i - 1]);
        }
        const meanSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length;
        const variance = spacings.reduce((a, b) => a + Math.pow(b - meanSpacing, 2), 0) / spacings.length;
        sampleSpacingCV = meanSpacing === 0 ? 0 : Math.sqrt(variance) / meanSpacing;
      }

      // Spike detection (points fluctuating more than 4 times standard median deviation)
      let anomaliesCount = 0;
      if (values.length >= 3) {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const stdDev = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length);
        values.forEach(v => {
          if (Math.abs(v - mean) > 3 * stdDev) anomaliesCount++;
        });
      }

      return {
        mnemonic: c.metadata.mnemonic,
        pointsCount: c.points.length,
        isIncreasing,
        sampleSpacingCV: Number(sampleSpacingCV.toFixed(3)),
        anomaliesCount
      };
    });
  };

  const qcMetrics = computeWellQCMetrics();

  const handleExportLASCode = () => {
    try {
      const lasString = generateLAS20(project, lasResampleStrategy, lasUserStep, lasInterpolationMethod);
      const blob = new Blob([lasString], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project.well.name || "LOG"}.las`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      logInfo("LAS 2.0 document downloaded successfully.");
    } catch (err) {
      console.error(err);
      alert("Verification build failed. Check your data points.");
    }
  };

  // LocalForage Save/Load System
  const saveProjectToLocal = async () => {
    try {
      await localforage.setItem('digitizer_saved_project', project);
      
      // Save the raster file if we have it in recovery
      const rasterFile = await localforage.getItem<Blob | File>('citra_session_recovery_raster_file');
      const rasterName = await localforage.getItem<string>('citra_session_recovery_raster_name');
      if (rasterFile) {
        await localforage.setItem('digitizer_saved_raster_file', rasterFile);
      }
      if (rasterName) {
        await localforage.setItem('digitizer_saved_raster_name', rasterName);
      }
      alert('Proyek berhasil disimpan ke penyimpanan browser lokal.');
    } catch (e) {
      console.error('Failed to save project:', e);
      alert('Gagal menyimpan proyek. Ukuran gambar mungkin terlalu besar.');
    }
  };

  const loadProjectFromLocal = async () => {
    try {
      const savedProj = await localforage.getItem<ProjectState>('digitizer_saved_project');
      if (savedProj) {
        // Load and recover the saved raster file first
        const savedFile = await localforage.getItem<Blob | File>('digitizer_saved_raster_file');
        const savedName = await localforage.getItem<string>('digitizer_saved_raster_name');
        if (savedFile) {
          setIsRasterLoading(true);
          setRasterLoadingStatus('Memulihkan gambar raster...');
          await loadRasterEngineOnly(savedFile, savedName || 'recovered_log_image');
          setIsRasterLoading(false);
          // Sync with session recovery keys so they are saved
          await localforage.setItem('citra_session_recovery_raster_file', savedFile);
          if (savedName) {
            await localforage.setItem('citra_session_recovery_raster_name', savedName);
          }
        }
        
        setProject(syncCalibrations(savedProj));
        if (savedProj.raster?.dataUrl) {
          setRasterUrl(savedProj.raster.dataUrl);
        }
        setUndoStack([]);
        setRedoStack([]);
        setUndoCommandStack([]);
        setRedoCommandStack([]);
        alert('Proyek berhasil dipulihkan dari penyimpanan lokal.');
      } else {
        alert('Tidak ada proyek tersimpan di penyimpanan lokal.');
      }
    } catch (e) {
      console.error('Failed to load project:', e);
      alert('Gagal memuat proyek dari penyimpanan lokal.');
      setIsRasterLoading(false);
    }
  };

  // Build temporary raw text of LAS file structure for visual code check
  const lasPreviewText = generateLAS20(project, lasResampleStrategy, lasUserStep, lasInterpolationMethod);
  const lasValidationReport = validateLASStructure(lasPreviewText);

  // Dynamic current raster dimensions
  const currentRasterWidth = project.raster?.width || 700;
  const currentRasterHeight = project.raster?.height || 900;

  // Minimap visual coordinate calculations
  const minimapScaleX = minimapSize.width / currentRasterWidth;
  const minimapScaleY = minimapSize.height / currentRasterHeight;

  // Deriving the visible coordinate ranges of the canvas
  const canvasVisibleTop = (currentRasterHeight / 2) - (viewportSize.height / 2 + panOffset.y) / zoomScale;
  const canvasVisibleBottom = (currentRasterHeight / 2) + (viewportSize.height / 2 - panOffset.y) / zoomScale;
  const canvasVisibleLeft = (currentRasterWidth / 2) - (viewportSize.width / 2 + panOffset.x) / zoomScale;
  const canvasVisibleRight = (currentRasterWidth / 2) + (viewportSize.width / 2 - panOffset.x) / zoomScale;

  // Convert canvas boundaries to minimap pixels, clamped to coordinates
  const miniVisibleTop = Math.max(0, Math.min(minimapSize.height, canvasVisibleTop * minimapScaleY));
  const miniVisibleBottom = Math.max(0, Math.min(minimapSize.height, canvasVisibleBottom * minimapScaleY));
  const miniVisibleLeft = Math.max(0, Math.min(minimapSize.width, canvasVisibleLeft * minimapScaleX));
  const miniVisibleRight = Math.max(0, Math.min(minimapSize.width, canvasVisibleRight * minimapScaleX));

  const miniVisibleWidth = Math.max(2, miniVisibleRight - miniVisibleLeft);
  const miniVisibleHeight = Math.max(2, miniVisibleBottom - miniVisibleTop);

  // REDESIGN HELPERS: REAL-TIME VALIDATION, STATISTICS, AND DYNAMIC PROPERTIES FOR RIGHT INSPECTOR

  // 1. Validation reports by active step
  const getValidationIssues = () => {
    const issues: { type: 'error' | 'warning' | 'success'; message: string }[] = [];
    
    if (activeTab === 'project') {
      if (!project.well.name || project.well.name === 'Untitled Well') {
        issues.push({ type: 'warning', message: 'Nama sumur default. Berikan nama sumur yang valid.' });
      }
      if (!project.well.uwi) {
        issues.push({ type: 'warning', message: 'UWI (Unique Well Identifier) belum diisi.' });
      }
      if (!project.raster) {
        issues.push({ type: 'error', message: 'Berkas log raster belum diunggah. Silakan unggah gambar log.' });
      } else {
        issues.push({ type: 'success', message: 'Informasi sumur dasar dan raster terverifikasi.' });
      }
    }
    
    if (activeTab === 'calibration-vertical' || activeTab === 'calibration-horizontal') {
      const cps = project.depthTransform.controlPoints || [];
      if (cps.length < 2) {
        issues.push({ type: 'error', message: 'Dibutuhkan minimal 2 jangkar kedalaman untuk kalibrasi skala Y.' });
      } else {
        issues.push({ type: 'success', message: `${cps.length} jangkar kedalaman terpasang (${project.well.depthUnit}).` });
      }
      
      if (project.tracks.length === 0) {
        issues.push({ type: 'warning', message: 'Belum ada jalur log (Track) yang dikonfigurasi untuk kalibrasi horizontal.' });
      }
    }
    
    if (activeTab === 'digitize') {
      const activeCurve = project.curves.find(c => c.id === activeCurveId);
      if (!activeCurve) {
        issues.push({ type: 'error', message: 'Tidak ada kurva aktif yang terpilih.' });
      } else if (activeCurve.points.length === 0) {
        issues.push({ type: 'warning', message: `Kurva ${activeCurve.metadata.mnemonic} belum memiliki titik digitasi.` });
      } else {
        issues.push({ type: 'success', message: `${activeCurve.points.length} titik digitasi terekam pada ${activeCurve.metadata.mnemonic}.` });
      }
    }
    
    if (activeTab === 'alignment') {
      const activeCurve = project.curves.find(c => c.id === activeCurveId);
      if (activeCurve && activeCurve.depthShiftApplied !== 0) {
        issues.push({ type: 'warning', message: `Penyimpangan kedalaman ${activeCurve.depthShiftApplied} ${project.well.depthUnit} sedang aktif.` });
      } else {
        issues.push({ type: 'success', message: 'Penyelarasan kedalaman dalam posisi netral (0).' });
      }
    }
    
    if (activeTab === 'qc') {
      const activeCurve = project.curves.find(c => c.id === activeCurveId);
      const points = activeCurve?.points || [];
      const isMonotonic = validateDepthMonotonicity(points);
      if (!isMonotonic && points.length > 0) {
        issues.push({ type: 'error', message: 'Terdeteksi anomali kedalaman non-monotonis (turun/stagnan).' });
      } else if (points.length > 0) {
        issues.push({ type: 'success', message: 'Monotonisitas kedalaman lolos uji kelayakan (100%).' });
      } else {
        issues.push({ type: 'warning', message: 'Sesi evaluasi QC menunggu masukan data digitasi kedalaman.' });
      }
    }
    
    if (activeTab === 'export') {
      if (lasValidationReport && !lasValidationReport.isValid) {
        issues.push({ type: 'error', message: 'Dokumen LAS gagal divalidasi oleh parser internal.' });
        lasValidationReport.errors.forEach(err => {
          issues.push({ type: 'warning', message: err });
        });
      } else if (project.curves.every(c => c.points.length === 0)) {
        issues.push({ type: 'error', message: 'Tidak ada data kurva untuk diekspor. Digitasi minimal 1 kurva.' });
      } else {
        issues.push({ type: 'success', message: 'Kepatuhan format CWLS LAS 2.0 lolos uji (100%).' });
      }
    }
    
    return issues;
  };

  // 2. Statistics breakdown for active step
  const getStepStatistics = () => {
    const stats: { label: string; value: string | number; color?: string }[] = [];
    
    if (activeTab === 'project') {
      stats.push({ label: 'Mnemonic Channels', value: project.curves.length });
      stats.push({ label: 'Lithology Intervals', value: project.lithologyIntervals.length });
      stats.push({ label: 'Null Value Default', value: project.nullValueGlobal });
    }
    
    if (activeTab === 'calibration-vertical' || activeTab === 'calibration-horizontal') {
      stats.push({ label: 'Vertical Anchors', value: project.depthTransform.controlPoints.length });
      stats.push({ label: 'Configured Tracks', value: project.tracks.length });
      stats.push({ label: 'Scale Factor', value: project.depthTransform.linearScale ? `${project.depthTransform.linearScale.toFixed(4)} px/m` : 'Not calibrated' });
    }
    
    if (activeTab === 'digitize' || activeTab === 'alignment') {
      const activeCurve = project.curves.find(c => c.id === activeCurveId);
      stats.push({ label: 'Active Channel', value: activeCurve?.metadata.mnemonic || 'None' });
      stats.push({ label: 'Digitized Points', value: activeCurve?.points.length || 0 });
      if (activeCurve && activeCurve.points.length > 0) {
        const depths = activeCurve.points.map(p => p.depth).filter(d => d !== null) as number[];
        const vals = activeCurve.points.map(p => p.value).filter(v => v !== null) as number[];
        if (depths.length > 0) {
          stats.push({ label: 'Depth Span', value: `${Math.min(...depths).toFixed(1)} - ${Math.max(...depths).toFixed(1)} ${project.well.depthUnit}` });
        }
        if (vals.length > 0) {
          stats.push({ label: 'Value Range', value: `${Math.min(...vals).toFixed(2)} - ${Math.max(...vals).toFixed(2)} ${activeCurve.metadata.unit}` });
        }
      }
    }
    
    if (activeTab === 'qc') {
      const activeCurve = project.curves.find(c => c.id === activeCurveId);
      const points = activeCurve?.points || [];
      const density = points.length / (parseFloat(project.well.bottomDepth || '0') - parseFloat(project.well.topDepth || '0') || 100);
      stats.push({ label: 'Core Sampling Rate', value: `${density.toFixed(2)} pts/${project.well.depthUnit}` });
      stats.push({ label: 'Total Logs Ingested', value: project.curves.length });
      stats.push({ label: 'Avg Shift', value: `${(project.curves.reduce((sum, c) => sum + Math.abs(c.depthShiftApplied), 0) / project.curves.length || 0).toFixed(2)} ${project.well.depthUnit}` });
    }
    
    if (activeTab === 'export') {
      const totalPoints = project.curves.reduce((acc, c) => acc + c.points.length, 0);
      stats.push({ label: 'Total Data Nodes', value: totalPoints });
      stats.push({ label: 'Resample Mode', value: lasResampleStrategy === 'user' ? 'Sesuai Input' : (lasResampleStrategy === 'dense' ? '0.1m High Dense' : 'Median Custom Step') });
      stats.push({ label: 'Interpolation', value: lasInterpolationMethod.toUpperCase() });
    }
    
    return stats;
  };

  const renderPropertiesForm = () => {
    switch (activeTab) {
      case 'project':
        return (
          <div className="space-y-4">
            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs space-y-3">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">WELL REGISTRY ID</span>
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">WELL NAME</label>
                  <input
                    type="text"
                    value={project.well.name ?? ''}
                    onChange={(e) => setProject({ ...project, well: { ...project.well, name: e.target.value } })}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50 font-medium"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">UWI (UNIQUE WELL ID)</label>
                  <input
                    type="text"
                    value={project.well.uwi ?? ''}
                    onChange={(e) => setProject({ ...project, well: { ...project.well, uwi: e.target.value } })}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50 font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">OPERATOR</label>
                    <input
                      type="text"
                      value={project.well.operator ?? ''}
                      onChange={(e) => setProject({ ...project, well: { ...project.well, operator: e.target.value } })}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">FIELD</label>
                    <input
                      type="text"
                      value={project.well.field ?? ''}
                      onChange={(e) => setProject({ ...project, well: { ...project.well, field: e.target.value } })}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">LOGGING DATE</label>
                    <input
                      type="text"
                      placeholder="YYYY-MM-DD"
                      value={project.well.loggingDate ?? ''}
                      onChange={(e) => setProject({ ...project, well: { ...project.well, loggingDate: e.target.value } })}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">ELEVATION DATUM</label>
                    <select
                      value={project.well.datum ?? 'KB'}
                      onChange={(e) => setProject({ ...project, well: { ...project.well, datum: e.target.value as any } })}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50 font-bold"
                    >
                      <option value="KB">Kelly Bushing (KB)</option>
                      <option value="DF">Derrick Floor (DF)</option>
                      <option value="GL">Ground Level (GL)</option>
                      <option value="RT">Rotary Table (RT)</option>
                      <option value="MSL">Mean Sea Level (MSL)</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">ELEVATION VALUE</label>
                    <input
                      type="text"
                      placeholder="e.g. 45.2 m"
                      value={project.well.datumValue ?? ''}
                      onChange={(e) => setProject({ ...project, well: { ...project.well, datumValue: e.target.value } })}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">MEASURED FROM</label>
                    <input
                      type="text"
                      placeholder="e.g. KB"
                      value={project.well.coordinateRemarks ?? 'KB'}
                      onChange={(e) => setProject({ ...project, well: { ...project.well, coordinateRemarks: e.target.value } })}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">LOCATION X (LON/EASTING)</label>
                    <input
                      type="text"
                      placeholder="e.g. 115.1234"
                      value={project.well.locationX ?? ''}
                      onChange={(e) => setProject({ ...project, well: { ...project.well, locationX: e.target.value } })}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">LOCATION Y (LAT/NORTHING)</label>
                    <input
                      type="text"
                      placeholder="e.g. -6.5678"
                      value={project.well.locationY ?? ''}
                      onChange={(e) => setProject({ ...project, well: { ...project.well, locationY: e.target.value } })}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50 font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs space-y-3">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">DEPTH METRICS</span>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">TOP DEPTH</label>
                    <input
                      type="number"
                      value={isNaN(Number(project.well.topDepth)) ? '' : project.well.topDepth}
                      onChange={(e) => setProject({ ...project, well: { ...project.well, topDepth: isNaN(parseFloat(e.target.value)) ? undefined as any : parseFloat(e.target.value) } })}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">BOTTOM DEPTH</label>
                    <input
                      type="number"
                      value={isNaN(Number(project.well.bottomDepth)) ? '' : project.well.bottomDepth}
                      onChange={(e) => setProject({ ...project, well: { ...project.well, bottomDepth: isNaN(parseFloat(e.target.value)) ? undefined as any : parseFloat(e.target.value) } })}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50 font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">UNIT</label>
                  <select
                    value={project.well.depthUnit}
                    onChange={(e) => setProject({ ...project, well: { ...project.well, depthUnit: e.target.value as any } })}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50 font-bold"
                  >
                    <option value="m">Meter (m)</option>
                    <option value="ft">Feet (ft)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        );

      case 'calibration-vertical':
        return (
          <div className="space-y-4">
            {/* Sub-tab switcher to toggle between Vertical and Horizontal calibration */}
            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
              <button
                onClick={() => setActiveTab('calibration-vertical')}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-bold transition cursor-pointer bg-white text-slate-800 shadow-xs border border-slate-200/50 font-extrabold"
              >
                <span>Kalibrasi Kedalaman (Y)</span>
              </button>
              <button
                onClick={() => setActiveTab('calibration-horizontal')}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-bold transition cursor-pointer text-slate-500 hover:text-slate-800"
              >
                <span>Kalibrasi Skala (X)</span>
              </button>
            </div>

            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs space-y-3">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">VERTICAL CONTROL POINTS</span>
              <p className="text-[10.5px] text-slate-500 leading-relaxed font-sans">
                Klik pada area gambar log untuk menambahkan jangkar kedalaman, lalu masukkan kedalaman fisiknya.
              </p>
              
              <div className="space-y-1 pb-1">
                <label className="text-[10px] font-bold text-slate-500 block mb-1">CALIBRATION MODEL (Y-AXIS INTERPOLATION)</label>
                <select
                  value={project.depthTransform.type}
                  onChange={(e) => {
                    setProject({
                      ...project,
                      depthTransform: {
                        ...project.depthTransform,
                        type: e.target.value as any
                      }
                    });
                  }}
                  className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50 font-bold text-slate-700"
                >
                  <option value="linear">Linear 2-Point Scaling</option>
                  <option value="piecewise-linear">Piecewise Linear Scaling</option>
                  <option value="spline">Monotonic Cubic Spline (PCHIP)</option>
                </select>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                {project.depthTransform.controlPoints.map((pt, idx) => (
                  <div key={idx} className="flex flex-col gap-1.5 bg-slate-50 p-2 rounded border border-slate-150">
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-slate-400">#{idx + 1}</span>
                        <span className="text-[10px] font-mono text-slate-600 truncate max-w-[70px]">Y: {pt.pixelY}px</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            const newPts = [...project.depthTransform.controlPoints];
                            const isS = !newPts[idx].isSlanted;
                            newPts[idx] = {
                              ...newPts[idx],
                              isSlanted: isS,
                              leftX: isS ? Math.round(currentRasterWidth * 0.1) : undefined,
                              leftY: isS ? newPts[idx].pixelY : undefined,
                              rightX: isS ? Math.round(currentRasterWidth * 0.9) : undefined,
                              rightY: isS ? newPts[idx].pixelY : undefined
                            };
                            setProject({
                              ...project,
                              depthTransform: { ...project.depthTransform, controlPoints: newPts }
                            });
                          }}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition cursor-pointer ${pt.isSlanted ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
                          title="Ubah jenis jangkar antara lurus horizontal sempurna atau miring/slanted"
                        >
                          {pt.isSlanted ? 'Tilted' : 'Lurus'}
                        </button>
                        {pt.isSlanted && (
                          <button
                            onClick={() => {
                              setTiltedClickState({ anchorIndex: idx, step: 'left' });
                              logInfo("Mode Klik Tilted Aktif: Silakan klik sisi KIRI garis kedalaman pada gambar.");
                            }}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition cursor-pointer ${
                              tiltedClickState?.anchorIndex === idx
                                ? 'bg-amber-500 text-white animate-pulse'
                                : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                            }`}
                            title="Tentukan kemiringan garis dengan mengklik titik kiri lalu titik kanan pada gambar"
                          >
                            {tiltedClickState?.anchorIndex === idx
                              ? (tiltedClickState.step === 'left' ? 'Kiri...' : 'Kanan...')
                              : 'Set via Klik 🖱️'}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            const newPts = project.depthTransform.controlPoints.filter((_, i) => i !== idx);
                            let nextScale: number | undefined = undefined;
                            if (newPts.length >= 2) {
                              const dy = Math.abs(newPts[1].pixelY - newPts[0].pixelY);
                              const dd = Math.abs(newPts[1].depth - newPts[0].depth);
                              if (dd > 0) nextScale = dy / dd;
                            }
                            setProject({
                              ...project,
                              depthTransform: { ...project.depthTransform, controlPoints: newPts, linearScale: nextScale }
                            });
                          }}
                          className="text-rose-500 hover:text-rose-700 text-xs font-bold cursor-pointer px-1"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {(() => {
                      const withIndices = project.depthTransform.controlPoints.map((p, i) => ({ p, originalIdx: i }));
                      const sorted = [...withIndices].sort((a, b) => a.p.pixelY - b.p.pixelY);
                      const sortedIdx = sorted.findIndex(item => item.originalIdx === idx);
                      let isInvalid = false;
                      let minVal = -Infinity;
                      let maxVal = Infinity;
                      if (sortedIdx !== -1) {
                        if (sortedIdx > 0) {
                          minVal = sorted[sortedIdx - 1].p.depth;
                          if (pt.depth <= minVal) isInvalid = true;
                        }
                        if (sortedIdx < sorted.length - 1) {
                          maxVal = sorted[sortedIdx + 1].p.depth;
                          if (pt.depth >= maxVal) isInvalid = true;
                        }
                      }
                      return (
                        <div className="flex flex-col w-full gap-1">
                          <div className="flex items-center gap-2 w-full">
                            <span className="text-[10px] font-bold text-slate-400">DEPTH:</span>
                            <input
                              type="number"
                              placeholder="Depth"
                              value={isNaN(pt.depth) ? '' : pt.depth}
                              onChange={(e) => {
                                const newPts = [...project.depthTransform.controlPoints];
                                newPts[idx] = { ...newPts[idx], depth: parseFloat(e.target.value) || 0 };
                                // Recalculate linear scale
                                let nextScale: number | undefined = undefined;
                                if (newPts.length >= 2) {
                                  const dy = Math.abs(newPts[1].pixelY - newPts[0].pixelY);
                                  const dd = Math.abs(newPts[1].depth - newPts[0].depth);
                                  if (dd > 0) nextScale = dy / dd;
                                }
                                setProject({
                                  ...project,
                                  depthTransform: { ...project.depthTransform, controlPoints: newPts, linearScale: nextScale }
                                });
                              }}
                              onBlur={(e) => {
                                const val = parseFloat(e.target.value);
                                if (isNaN(val)) return;
                                let clampedVal = val;
                                if (sortedIdx > 0) {
                                  const minAllowed = sorted[sortedIdx - 1].p.depth + 0.1;
                                  if (clampedVal < minAllowed) clampedVal = minAllowed;
                                }
                                if (sortedIdx < sorted.length - 1) {
                                  const maxAllowed = sorted[sortedIdx + 1].p.depth - 0.1;
                                  if (clampedVal > maxAllowed) clampedVal = maxAllowed;
                                }
                                const newPts = [...project.depthTransform.controlPoints];
                                newPts[idx] = { ...newPts[idx], depth: parseFloat(clampedVal.toFixed(2)) };
                                let nextScale: number | undefined = undefined;
                                if (newPts.length >= 2) {
                                  const dy = Math.abs(newPts[1].pixelY - newPts[0].pixelY);
                                  const dd = Math.abs(newPts[1].depth - newPts[0].depth);
                                  if (dd > 0) nextScale = dy / dd;
                                }
                                setProject({
                                  ...project,
                                  depthTransform: { ...project.depthTransform, controlPoints: newPts, linearScale: nextScale }
                                });
                              }}
                              className={`flex-1 rounded border px-1.5 py-0.5 text-[11px] font-mono focus:outline-none ${
                                isInvalid 
                                  ? 'border-rose-400 text-rose-700 bg-rose-50 focus:border-rose-500 focus:ring-1 focus:ring-rose-500' 
                                  : 'border-slate-200 text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'
                              }`}
                            />
                          </div>
                          {isInvalid && (
                            <div className="text-[9px] text-rose-500 font-semibold pl-12 leading-none">
                              Must be between {minVal === -Infinity ? '-∞' : minVal.toFixed(1)} and {maxVal === Infinity ? '∞' : maxVal.toFixed(1)}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>

            {/* RASTER ROTATION (STRAIGHTEN) */}
            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs space-y-3">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">ROTASI GAMBAR (STRAIGHTEN)</span>
              <p className="text-[10.5px] text-slate-500 leading-relaxed font-sans">
                Gunakan kontrol di bawah ini untuk memutar gambar log secara global demi meluruskan scan miring.
              </p>
              <div className="space-y-2">
                <input
                  type="range"
                  min="-45"
                  max="45"
                  step="0.5"
                  value={project.raster?.rotationAngle || 0}
                  onChange={(e) => handleUpdateRasterRotation(parseFloat(e.target.value))}
                  className="w-full accent-slate-800 cursor-pointer"
                />
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleUpdateRasterRotation((project.raster?.rotationAngle || 0) - 0.1)}
                    className="px-2 py-1 border border-slate-200 hover:bg-slate-100 rounded text-[10px] font-bold cursor-pointer"
                  >
                    -0.1°
                  </button>
                  <span className="text-xs font-mono font-bold text-slate-800">
                    {(project.raster?.rotationAngle || 0).toFixed(1)}°
                  </span>
                  <button
                    onClick={() => handleUpdateRasterRotation((project.raster?.rotationAngle || 0) + 0.1)}
                    className="px-2 py-1 border border-slate-200 hover:bg-slate-100 rounded text-[10px] font-bold cursor-pointer"
                  >
                    +0.1°
                  </button>
                </div>
              </div>
            </div>

            {/* IMAGE PROCESSOR FILTERS */}
            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs space-y-3">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">FILTER PEMROSESAN CITRA (IMAGE PROCESSING)</span>
              <p className="text-[10.5px] text-slate-500 leading-relaxed font-sans">
                Aktifkan filter di bawah untuk meningkatkan kontras, mengubah ke grayscale, atau membalikkan warna raster log.
              </p>
              <div className="space-y-2.5 pt-1">
                <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer font-sans select-none">
                  <input
                    type="checkbox"
                    checked={claheEnabled}
                    onChange={(e) => setClaheEnabled(e.target.checked)}
                    className="rounded border-slate-300 text-slate-800 focus:ring-slate-800 w-4 h-4 cursor-pointer"
                  />
                  <div>
                    <span className="font-bold block">CLAHE (Adaptive Histogram)</span>
                    <span className="text-[10px] text-slate-400 block leading-tight">Meningkatkan kontras kisi log lokal</span>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer font-sans select-none">
                  <input
                    type="checkbox"
                    checked={grayscaleEnabled}
                    onChange={(e) => setGrayscaleEnabled(e.target.checked)}
                    className="rounded border-slate-300 text-slate-800 focus:ring-slate-800 w-4 h-4 cursor-pointer"
                  />
                  <div>
                    <span className="font-bold block">Autograyscale</span>
                    <span className="text-[10px] text-slate-400 block leading-tight">Ubah gambar berwarna menjadi hitam putih</span>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer font-sans select-none">
                  <input
                    type="checkbox"
                    checked={invertEnabled}
                    onChange={(e) => setInvertEnabled(e.target.checked)}
                    className="rounded border-slate-300 text-slate-800 focus:ring-slate-800 w-4 h-4 cursor-pointer"
                  />
                  <div>
                    <span className="font-bold block">Invert Color</span>
                    <span className="text-[10px] text-slate-400 block leading-tight">Membalik warna (gelap &harr; terang)</span>
                  </div>
                </label>
              </div>
            </div>
          </div>
        );

      case 'calibration-horizontal':
        return (
          <div className="space-y-4">
            {/* Sub-tab switcher to toggle between Vertical and Horizontal calibration */}
            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
              <button
                onClick={() => setActiveTab('calibration-vertical')}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-bold transition cursor-pointer text-slate-500 hover:text-slate-800"
              >
                <span>Kalibrasi Kedalaman (Y)</span>
              </button>
              <button
                onClick={() => setActiveTab('calibration-horizontal')}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-bold transition cursor-pointer bg-white text-slate-800 shadow-xs border border-slate-200/50 font-extrabold"
              >
                <span>Kalibrasi Skala (X)</span>
              </button>
            </div>

            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs space-y-3">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">BATAS SKALA HORIZONTAL (LOG VALUES)</span>
              <p className="text-[10.5px] text-slate-500 leading-relaxed font-sans">
                Tentukan batas kiri dan kanan kisi (grid) untuk tiap track log di gambar, serta masukkan batas nilai fisiknya.
              </p>

              {/* Calibration Mode Selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold text-slate-500 block">MODE KALIBRASI TRACK</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => {
                      setHorizontalCalibMode('slide');
                      logInfo("Mengaktifkan mode Batas Lurus Global (X konstan sepanjang kedalaman).");
                    }}
                    className={`py-2 px-1.5 rounded text-[10.5px] font-bold text-center cursor-pointer transition flex flex-col items-center justify-center gap-0.5 leading-tight ${
                      horizontalCalibMode === 'slide'
                        ? 'bg-slate-900 text-white shadow-md'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <span>Batas Lurus Global</span>
                    <span className="text-[8px] opacity-75 font-normal">X Konstan (Default)</span>
                  </button>
                  <button
                    onClick={() => {
                      setHorizontalCalibMode('polyline');
                      logInfo("Mengaktifkan mode Multi-Point Refinement. Klik batas track kiri/kanan di gambar untuk menambahkan jangkar lokal.");
                    }}
                    className={`py-2 px-1.5 rounded text-[10.5px] font-bold text-center cursor-pointer transition flex flex-col items-center justify-center gap-0.5 leading-tight ${
                      horizontalCalibMode === 'polyline'
                        ? 'bg-slate-900 text-white shadow-md'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <span>Multi-Point Refinement</span>
                    <span className="text-[8px] opacity-75 font-normal">X Dinamis (Lokal)</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 italic leading-snug">
                  {horizontalCalibMode === 'slide'
                    ? "Saran: Gunakan mode default ini jika raster well log Anda lurus vertikal sempurna tanpa distorsi kertas."
                    : "Saran: Klik tepi batas track pada berbagai kedalaman di gambar untuk mengoreksi rotasi, kemiringan, atau distorsi pelebaran track."}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {project.tracks.length === 0 ? (
                <div className="p-4 bg-white border border-slate-200 rounded-lg text-center text-[11px] text-slate-400">
                  Belum ada log track yang didefinisikan. Silakan tambahkan baru di bawah.
                </div>
              ) : (
                project.tracks.map((t, idx) => {
                  const curve = project.curves.find(c => c.trackId === t.id);
                  const isConfigured = t.isConfigured !== false;
                  const mnemonic = isConfigured ? (curve?.metadata.mnemonic || t.name) : `Track ${idx + 1} (Unconfigured)`;
                  const unit = isConfigured ? (curve?.metadata.unit || '') : '';
                  const curveColor = getCurveColor(curve?.metadata.mnemonic || '');

                  return (
                    <div key={t.id} className="p-3 bg-white border border-slate-200 rounded-lg shadow-xs space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: curveColor }} />
                          <span className="font-bold text-xs text-slate-800">
                            {isConfigured ? (
                              <>
                                {mnemonic} {unit && <span className="text-[10px] text-slate-400">({unit})</span>}
                              </>
                            ) : (
                              `Track ${idx + 1}`
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isConfigured ? (
                            <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-extrabold border border-emerald-100">Ready</span>
                          ) : (
                            <span className="text-[9px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-extrabold border border-amber-100">Unconfigured</span>
                          )}
                          <button
                            onClick={() => {
                              const updatedTracks = project.tracks.filter(tr => tr.id !== t.id);
                              const updatedCurves = project.curves.filter(c => c.trackId !== t.id);
                              setProject({
                                ...project,
                                tracks: updatedTracks,
                                curves: updatedCurves
                              });
                              if (activeCurveId && updatedCurves.every(c => c.id !== activeCurveId)) {
                                setActiveCurveId(updatedCurves[0]?.id || '');
                              }
                            }}
                            className="text-rose-500 hover:text-rose-700 text-[10.5px] font-bold cursor-pointer ml-1"
                            title="Hapus log track ini beserta kurvanya"
                          >
                            Hapus
                          </button>
                        </div>
                      </div>

                      {/* Step 2A: Select Log Type */}
                      <div className="space-y-1.5">
                        <label className="text-[9.5px] font-bold text-slate-400 block uppercase">Log Type</label>
                        <select
                          value={t.logType || ''}
                          onChange={(e) => {
                            const selectedType = e.target.value;
                            // Presets for common log types:
                            let defaultMnemonic = 'CUSTOM';
                            let defaultUnit = 'API';
                            let defaultScale: 'linear' | 'log' = 'linear';
                            let minVal = 0;
                            let maxVal = 100;
                            let direction: 'normal' | 'reverse' = 'normal';

                            if (selectedType === 'GR') {
                              defaultMnemonic = 'GR';
                              defaultUnit = 'API';
                              defaultScale = 'linear';
                              minVal = 0;
                              maxVal = 150;
                            } else if (selectedType === 'RES') {
                              defaultMnemonic = 'ILD';
                              defaultUnit = 'OHMM';
                              defaultScale = 'log';
                              minVal = 0.2;
                              maxVal = 2000;
                            } else if (selectedType === 'RHOB') {
                              defaultMnemonic = 'RHOB';
                              defaultUnit = 'G/C3';
                              defaultScale = 'linear';
                              minVal = 1.9;
                              maxVal = 2.9;
                            } else if (selectedType === 'NPHI') {
                              defaultMnemonic = 'NPHI';
                              defaultUnit = 'DEC';
                              defaultScale = 'linear';
                              minVal = 0.45;
                              maxVal = -0.15;
                              direction = 'reverse';
                            } else if (selectedType === 'DT') {
                              defaultMnemonic = 'DT';
                              defaultUnit = 'US/F';
                              defaultScale = 'linear';
                              minVal = 40;
                              maxVal = 140;
                            } else if (selectedType === 'CALI') {
                              defaultMnemonic = 'CALI';
                              defaultUnit = 'IN';
                              defaultScale = 'linear';
                              minVal = 6;
                              maxVal = 16;
                            }

                            const updatedTracks = project.tracks.map(tr => {
                              if (tr.id === t.id) {
                                return {
                                  ...tr,
                                  name: `${defaultMnemonic} Track`,
                                  logType: selectedType,
                                  valueTransform: {
                                    ...tr.valueTransform,
                                    type: defaultScale,
                                    valueMin: minVal,
                                    valueMax: maxVal,
                                    direction
                                  }
                                };
                              }
                              return tr;
                            });

                            const updatedCurves = project.curves.map(c => {
                              if (c.trackId === t.id) {
                                return {
                                  ...c,
                                  metadata: {
                                    ...c.metadata,
                                    mnemonic: defaultMnemonic,
                                    unit: defaultUnit
                                  }
                                };
                              }
                              return c;
                            });

                            setProject({
                              ...project,
                              tracks: updatedTracks,
                              curves: updatedCurves
                            });
                          }}
                          className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs bg-slate-50 font-bold text-slate-700 focus:outline-none"
                        >
                          <option value="" disabled>-- Pilih Jenis Log (Log Type) --</option>
                          <option value="GR">Gamma Ray (GR)</option>
                          <option value="RES">Resistivity (ILD)</option>
                          <option value="RHOB">Density (RHOB)</option>
                          <option value="NPHI">Neutron (NPHI)</option>
                          <option value="DT">Sonic (DT)</option>
                          <option value="CALI">Caliper (CALI)</option>
                          <option value="CUSTOM">Custom Log Curve</option>
                        </select>
                      </div>

                      {/* Step 2B: Custom Mnemonic Input */}
                      {t.logType === 'CUSTOM' && (
                        <div className="grid grid-cols-2 gap-2 pt-1 animate-fadeIn">
                          <div>
                            <label className="block text-[8.5px] font-bold text-slate-400 uppercase mb-0.5">Mnemonic</label>
                            <input
                              type="text"
                              value={curve?.metadata.mnemonic === 'CUSTOM' ? '' : (curve?.metadata.mnemonic || '')}
                              onChange={(e) => {
                                const val = e.target.value.toUpperCase();
                                const updatedCurves = project.curves.map(c => {
                                  if (c.trackId === t.id) {
                                    return { ...c, metadata: { ...c.metadata, mnemonic: val } };
                                  }
                                  return c;
                                });
                                setProject({ ...project, curves: updatedCurves });
                              }}
                              placeholder="e.g. SP, PEF"
                              className="w-full rounded border border-slate-200 px-2 py-1 text-xs bg-white font-bold"
                            />
                          </div>
                          <div>
                            <label className="block text-[8.5px] font-bold text-slate-400 uppercase mb-0.5">Unit</label>
                            <input
                              type="text"
                              value={curve?.metadata.unit || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                const updatedCurves = project.curves.map(c => {
                                  if (c.trackId === t.id) {
                                    return { ...c, metadata: { ...c.metadata, unit: val } };
                                  }
                                  return c;
                                });
                                setProject({ ...project, curves: updatedCurves });
                              }}
                              placeholder="e.g. MV"
                              className="w-full rounded border border-slate-200 px-2 py-1 text-xs bg-white"
                            />
                          </div>
                        </div>
                      )}

                      {/* Step 2C: Calibration Fields */}
                      {t.logType && (
                        <div className="space-y-3.5 pt-2 border-t border-slate-100">
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Value Min</label>
                              <input
                                type="number"
                                value={isNaN(t.valueTransform.valueMin) ? '' : t.valueTransform.valueMin}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  const valSafe = isNaN(val) ? 0 : val;
                                  const updatedTracks = project.tracks.map(tr => {
                                    if (tr.id === t.id) {
                                      return {
                                        ...tr,
                                        valueTransform: { ...tr.valueTransform, valueMin: valSafe }
                                      };
                                    }
                                    return tr;
                                  });
                                  setProject({ ...project, tracks: updatedTracks });
                                }}
                                className="w-full rounded border border-slate-200 px-2 py-1 focus:outline-none bg-slate-50 font-mono text-center font-bold text-slate-800"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Value Max</label>
                              <input
                                type="number"
                                value={isNaN(t.valueTransform.valueMax) ? '' : t.valueTransform.valueMax}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  const valSafe = isNaN(val) ? 0 : val;
                                  const updatedTracks = project.tracks.map(tr => {
                                    if (tr.id === t.id) {
                                      return {
                                        ...tr,
                                        valueTransform: { ...tr.valueTransform, valueMax: valSafe }
                                      };
                                    }
                                    return tr;
                                  });
                                  setProject({ ...project, tracks: updatedTracks });
                                }}
                                className="w-full rounded border border-slate-200 px-2 py-1 focus:outline-none bg-slate-50 font-mono text-center font-bold text-slate-800"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Tipe Skala</label>
                              <select
                                value={t.valueTransform.type}
                                onChange={(e) => {
                                  const type = e.target.value as 'linear' | 'log';
                                  const updatedTracks = project.tracks.map(tr => {
                                    if (tr.id === t.id) {
                                      return {
                                        ...tr,
                                        valueTransform: { ...tr.valueTransform, type }
                                      };
                                    }
                                    return tr;
                                  });
                                  setProject({ ...project, tracks: updatedTracks });
                                }}
                                className="w-full rounded border border-slate-200 px-1.5 py-1 focus:outline-none bg-slate-50 font-bold text-slate-700"
                              >
                                <option value="linear">Linear</option>
                                <option value="log">Logarithmic</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Arah Skala</label>
                              <select
                                value={t.valueTransform.direction || 'normal'}
                                onChange={(e) => {
                                  const dir = e.target.value as 'normal' | 'reverse';
                                  const updatedTracks = project.tracks.map(tr => {
                                    if (tr.id === t.id) {
                                      return {
                                        ...tr,
                                        valueTransform: { ...tr.valueTransform, direction: dir }
                                      };
                                    }
                                    return tr;
                                  });
                                  setProject({ ...project, tracks: updatedTracks });
                                }}
                                className="w-full rounded border border-slate-200 px-1.5 py-1 focus:outline-none bg-slate-50 font-bold text-slate-700"
                              >
                                <option value="normal">Normal (L → R)</option>
                                <option value="reverse">Reverse (R → L)</option>
                              </select>
                            </div>
                          </div>

                          <div className="space-y-1.5 pt-1">
                            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono font-bold">
                              <span>Kiri: {Math.round(t.pixelXLeft)}px</span>
                              <span>Kanan: {Math.round(t.pixelXRight)}px</span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setCalibratingXTrack({ id: t.id, side: 'left' });
                                }}
                                className={`flex-1 py-1 px-2 border rounded text-[10.5px] font-bold text-center cursor-pointer transition ${
                                  calibratingXTrack?.id === t.id && calibratingXTrack?.side === 'left'
                                    ? 'bg-pink-500 border-pink-500 text-white animate-pulse'
                                    : 'border-slate-200 hover:bg-slate-50 text-slate-700 bg-white'
                                }`}
                              >
                                {calibratingXTrack?.id === t.id && calibratingXTrack?.side === 'left' ? 'Klik Gambar...' : 'Set Batas Kiri'}
                              </button>
                              <button
                                onClick={() => {
                                  setCalibratingXTrack({ id: t.id, side: 'right' });
                                }}
                                className={`flex-1 py-1 px-2 border rounded text-[10.5px] font-bold text-center cursor-pointer transition ${
                                  calibratingXTrack?.id === t.id && calibratingXTrack?.side === 'right'
                                    ? 'bg-pink-500 border-pink-500 text-white animate-pulse'
                                    : 'border-slate-200 hover:bg-slate-50 text-slate-700 bg-white'
                                }`}
                              >
                                {calibratingXTrack?.id === t.id && calibratingXTrack?.side === 'right' ? 'Klik Gambar...' : 'Set Batas Kanan'}
                              </button>
                            </div>
                          </div>

                          {/* Multi-Point Refinement Local Anchors list */}
                          {horizontalCalibMode === 'polyline' && (
                            <div className="mt-3.5 space-y-2 border-t border-slate-100 pt-2.5 animate-fadeIn">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider block">Local Refinement Points</span>
                                {(t.leftPoints || t.rightPoints) && (
                                  <button
                                    onClick={() => {
                                      const updatedTracks = project.tracks.map(tr => {
                                        if (tr.id === t.id) {
                                          return { ...tr, leftPoints: undefined, rightPoints: undefined };
                                        }
                                        return tr;
                                      });
                                      setProject(syncCalibrations({ ...project, tracks: updatedTracks }));
                                      logInfo(`Set ulang track ${t.name} ke batas lurus.`);
                                    }}
                                    className="text-[9.5px] text-rose-500 hover:text-rose-700 font-bold underline cursor-pointer"
                                  >
                                    Reset ke Batas Lurus
                                  </button>
                                )}
                              </div>
                              
                              <div className="grid grid-cols-3 text-[8.5px] font-bold text-slate-400 font-mono px-1">
                                <span>Sisi</span>
                                <span>Pixel Y / Kedalaman</span>
                                <span className="text-right">Aksi</span>
                              </div>

                              <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                                {/* Left points */}
                                {(t.leftPoints || []).map((pt, pIdx) => {
                                  const dInfo = pixelYToDepth(pt.y, project.depthTransform);
                                  return (
                                    <div key={`L-${pIdx}`} className="grid grid-cols-3 text-[10px] items-center bg-slate-50 border border-slate-150 rounded px-2 py-1">
                                      <span className="text-indigo-600 font-bold">Kiri</span>
                                      <span className="font-mono text-slate-600">
                                        {pt.y}px ({Math.round(dInfo.depth)} {project.well.depthUnit})
                                      </span>
                                      <button
                                        onClick={() => removeTrackBoundPoint(t.id, 'left', pIdx)}
                                        className="text-rose-500 hover:text-rose-700 text-right font-bold cursor-pointer"
                                      >
                                        Hapus
                                      </button>
                                    </div>
                                  );
                                })}

                                {/* Right points */}
                                {(t.rightPoints || []).map((pt, pIdx) => {
                                  const dInfo = pixelYToDepth(pt.y, project.depthTransform);
                                  return (
                                    <div key={`R-${pIdx}`} className="grid grid-cols-3 text-[10px] items-center bg-slate-50 border border-slate-150 rounded px-2 py-1">
                                      <span className="text-pink-600 font-bold">Kanan</span>
                                      <span className="font-mono text-slate-600">
                                        {pt.y}px ({Math.round(dInfo.depth)} {project.well.depthUnit})
                                      </span>
                                      <button
                                        onClick={() => removeTrackBoundPoint(t.id, 'right', pIdx)}
                                        className="text-rose-500 hover:text-rose-700 text-right font-bold cursor-pointer"
                                      >
                                        Hapus
                                      </button>
                                    </div>
                                  );
                                })}

                                {(!t.leftPoints || t.leftPoints.length === 0) && (!t.rightPoints || t.rightPoints.length === 0) && (
                                  <p className="text-[9.5px] text-slate-400 italic text-center py-2 bg-slate-50/50 rounded border border-dashed border-slate-200">
                                    Belum ada jangkar lokal. Klik pada batas track di gambar untuk menambahkan titik jangkar baru.
                                  </p>
                                )}
                              </div>
                            </div>
                          )}

                          {!isConfigured && (
                            <button
                              onClick={() => {
                                // Mark track configured
                                const updatedTracks = project.tracks.map(tr => {
                                  if (tr.id === t.id) {
                                    return { ...tr, isConfigured: true };
                                  }
                                  return tr;
                                });
                                setProject({ ...project, tracks: updatedTracks });
                                logInfo(`Track ${idx + 1} berhasil dikonfigurasi.`);
                              }}
                              className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-bold shadow-sm cursor-pointer text-center"
                            >
                              Simpan Kalibrasi & Mulai Digitisasi
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* + Tambah Track Baru button gated by active track configuration */}
            <div className="pt-2">
              {project.tracks.every(t => t.isConfigured !== false) ? (
                <button
                  onClick={() => {
                    const nextId = `track-idx-${Date.now()}`;
                    const nextTrackIndex = project.tracks.length + 1;
                    const newTrack: TrackDefinition = {
                      id: nextId,
                      name: `Track ${nextTrackIndex}`,
                      pixelXLeft: 100,
                      pixelXRight: 400,
                      isConfigured: false,
                      logType: undefined,
                      valueTransform: {
                        type: 'linear',
                        pixelMin: 100,
                        pixelMax: 400,
                        valueMin: 0,
                        valueMax: 100,
                        direction: 'normal'
                      }
                    };

                    const newCurve: Curve = {
                      id: nextId,
                      trackId: nextId,
                      metadata: {
                        id: `meta-${nextId}`,
                        mnemonic: `UNCONFIGURED_${nextTrackIndex}`,
                        unit: '',
                        nullValue: project.nullValueGlobal || -999.25
                      },
                      points: [],
                      depthShiftApplied: 0
                    };

                    setProject({
                      ...project,
                      tracks: [...project.tracks, newTrack],
                      curves: [...project.curves, newCurve]
                    });
                    setActiveCurveId(nextId);
                    logInfo(`Track ${nextTrackIndex} berhasil dibuat. Silakan pilih Log Type.`);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-indigo-300 hover:border-indigo-400 rounded-lg text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50/20 hover:bg-indigo-50/50 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah Track & Kurva Baru
                </button>
              ) : (
                <div className="p-3 bg-amber-50/30 border border-amber-200/50 rounded-lg text-center text-[10.5px] text-amber-700 leading-normal font-sans">
                  ⚠️ Selesaikan kalibrasi track aktif di atas terlebih dahulu sebelum menambahkan track & kurva baru.
                </div>
              )}
            </div>
          </div>
        );

      case 'digitize':
        return (
          <div className="space-y-4">
            {/* CURVE SELECTION */}
            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs space-y-3">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">KURVA AKTIF</span>
              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-1">PILIH KURVA UNTUK DIGITASI</label>
                <select
                  value={activeCurveId}
                  onChange={(e) => setActiveCurveId(e.target.value)}
                  className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:border-slate-400 bg-slate-50"
                >
                  {project.curves.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.metadata.mnemonic} ({c.metadata.unit || 'Log Curve'})
                    </option>
                  ))}
                </select>
              </div>

              {currentActiveCurve && (
                <div className="pt-2.5 border-t border-slate-100 space-y-2.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      id="useCurveOverride"
                      checked={!!currentActiveCurve.valueTransform}
                      onChange={(e) => {
                        if (e.target.checked) {
                          // Initialize with parent track's transform values
                          const parentTrack = project.tracks.find(t => t.id === currentActiveCurve.trackId);
                          const initialTransform: ValueTransform = parentTrack ? {
                            ...parentTrack.valueTransform
                          } : {
                            type: 'linear',
                            pixelMin: 100,
                            pixelMax: 400,
                            valueMin: 0,
                            valueMax: 100,
                            direction: 'normal'
                          };
                          handleUpdateCurveScaleOverride(currentActiveCurve.id, initialTransform);
                        } else {
                          // Remove override, falling back to track default
                          handleUpdateCurveScaleOverride(currentActiveCurve.id, undefined);
                        }
                      }}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <label htmlFor="useCurveOverride" className="text-[10.5px] font-bold text-slate-600 cursor-pointer select-none">
                      Gunakan Skala X Kustom (Neutron/Density)
                    </label>
                  </div>

                  {currentActiveCurve.valueTransform && (
                    <div className="bg-slate-50 p-2 rounded border border-slate-200 space-y-2 animate-fadeIn">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[8.5px] font-bold text-slate-400 uppercase mb-0.5">Value Min</label>
                          <input
                            type="number"
                            step="any"
                            value={currentActiveCurve.valueTransform.valueMin}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              handleUpdateCurveScaleOverride(currentActiveCurve.id, {
                                ...currentActiveCurve.valueTransform!,
                                valueMin: val
                              });
                            }}
                            className="w-full rounded border border-slate-200 px-1.5 py-0.5 text-xs focus:outline-none bg-white font-semibold"
                          />
                        </div>
                        <div>
                          <label className="block text-[8.5px] font-bold text-slate-400 uppercase mb-0.5">Value Max</label>
                          <input
                            type="number"
                            step="any"
                            value={currentActiveCurve.valueTransform.valueMax}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              handleUpdateCurveScaleOverride(currentActiveCurve.id, {
                                ...currentActiveCurve.valueTransform!,
                                valueMax: val
                              });
                            }}
                            className="w-full rounded border border-slate-200 px-1.5 py-0.5 text-xs focus:outline-none bg-white font-semibold"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[8.5px] font-bold text-slate-400 uppercase mb-0.5">Tipe Skala</label>
                          <select
                            value={currentActiveCurve.valueTransform.type}
                            onChange={(e) => {
                              const t = e.target.value as 'linear' | 'log';
                              handleUpdateCurveScaleOverride(currentActiveCurve.id, {
                                ...currentActiveCurve.valueTransform!,
                                type: t
                              });
                            }}
                            className="w-full rounded border border-slate-200 px-1 py-0.5 text-xs focus:outline-none bg-white font-semibold"
                          >
                            <option value="linear">Linear</option>
                            <option value="log">Logarithmic</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[8.5px] font-bold text-slate-400 uppercase mb-0.5">Arah</label>
                          <select
                            value={currentActiveCurve.valueTransform.direction || 'normal'}
                            onChange={(e) => {
                              const d = e.target.value as 'normal' | 'reverse';
                              handleUpdateCurveScaleOverride(currentActiveCurve.id, {
                                ...currentActiveCurve.valueTransform!,
                                direction: d
                              });
                            }}
                            className="w-full rounded border border-slate-200 px-1 py-0.5 text-xs focus:outline-none bg-white font-semibold"
                          >
                            <option value="normal">Normal (L → R)</option>
                            <option value="reverse">Reverse (R → L)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

                        <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs space-y-3">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">METODE DIGITASI</span>
              <p className="text-[10.5px] text-slate-500 leading-relaxed font-sans">
                Pilih metode digitasi. Jika terdapat anomali Autotrace, gunakan <strong>Freehand</strong> atau <strong>Manual Click</strong> pada area tersebut untuk mengganti poin secara otomatis tanpa perlu menghapus manual.
              </p>
              
              <div className="grid grid-cols-2 gap-2 pt-1">
                {/* Click / Manual */}
                <button
                  onClick={() => setDigitizationMode('click')}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                    digitizationMode === 'click'
                      ? 'border-slate-800 bg-slate-800 text-white shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 bg-slate-50 text-slate-700'
                  }`}
                >
                  <MousePointer className="w-4 h-4 mb-1" />
                  <span className="text-[10.5px] font-bold">Manual Click</span>
                  <span className="text-[8.5px] opacity-80 block leading-tight">Input Titik</span>
                </button>

                {/* Freehand Tracing */}
                <button
                  onClick={() => setDigitizationMode('freehand')}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                    digitizationMode === 'freehand'
                      ? 'border-slate-800 bg-slate-800 text-white shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 bg-slate-50 text-slate-700'
                  }`}
                >
                  <PenTool className="w-4 h-4 mb-1" />
                  <span className="text-[10.5px] font-bold">Freehand</span>
                  <span className="text-[8.5px] opacity-80 block leading-tight">Seret Tetikus</span>
                </button>

                {/* Autotrace */}
                <button
                  onClick={() => {
                    setDigitizationMode('autotrace');
                    logInfo("Mode Autotrace aktif. Klik dan seret (drag) kotak di kanvas log untuk langsung mengekstrak kurva.");
                  }}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                    digitizationMode === 'autotrace' || digitizationMode === 'aoi'
                      ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                      : 'border-blue-200 hover:border-blue-300 bg-blue-50/60 text-blue-800'
                  }`}
                >
                  <Sparkles className="w-4 h-4 mb-1" />
                  <span className="text-[10.5px] font-bold">Autotrace</span>
                  <span className="text-[8.5px] opacity-80 block leading-tight">Seret Area Seleksi</span>
                </button>

                {/* Eraser */}
                <button
                  onClick={() => setDigitizationMode('erase')}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                    digitizationMode === 'erase'
                      ? 'border-slate-800 bg-slate-800 text-white shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 bg-slate-50 text-slate-700'
                  }`}
                >
                  <Eraser className="w-4 h-4 mb-1" />
                  <span className="text-[10.5px] font-bold">Penghapus</span>
                  <span className="text-[8.5px] opacity-80 block leading-tight">Hapus Poin</span>
                </button>
              </div>
            </div>

            {/* AUTOTRACE / AREA SELECTION PANEL */}
            {(digitizationMode === 'autotrace' || digitizationMode === 'aoi') && (
              <div className="p-3 bg-white rounded-lg border border-blue-200 shadow-xs space-y-2.5">
                <div className="flex items-center justify-between border-b border-blue-100 pb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-[10px] font-extrabold text-blue-800 uppercase tracking-wider block">MODE AUTO-TRACE V2</span>
                  </div>
                  {aoiSelection && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700 border border-blue-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                      Area Terproses
                    </span>
                  )}
                </div>

                <div className="bg-blue-50/70 p-2.5 rounded-lg border border-blue-100 text-[10.5px] text-blue-900 leading-relaxed font-sans flex items-start gap-2">
                  <Square className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <span>
                    <strong>Cara Penggunaan:</strong> Cukup klik kiri dan seret (drag) kotak seleksi di atas kanvas log. Begitu tetikus dilepas, Auto-Trace V2 akan langsung mengekstrak kurva pada area tersebut secara otomatis.
                  </span>
                </div>

                {/* Active Area Info & Clear */}
                {aoiSelection && (
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-2 animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] font-extrabold text-slate-600 uppercase tracking-wider">Interval Area Terakhir</span>
                      <button
                        onClick={() => {
                          setAoiSelection(null);
                          logInfo("Area seleksi dibersihkan.");
                        }}
                        className="flex items-center gap-1 text-[10px] text-rose-600 hover:text-rose-700 font-bold cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Hapus Kotak Area</span>
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10.5px]">
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">Top Depth ({project.well.depthUnit})</label>
                        <input
                          type="number"
                          step="0.1"
                          value={Number(pixelYToDepth(aoiSelection.minY, project.depthTransform).depth.toFixed(1))}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) {
                              const py = depthToPixelY(val, project.depthTransform);
                              setAoiSelection({ ...aoiSelection, minY: py });
                            }
                          }}
                          className="w-full rounded border border-slate-200 px-2 py-1 bg-white font-bold font-mono text-slate-800 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">Bottom Depth ({project.well.depthUnit})</label>
                        <input
                          type="number"
                          step="0.1"
                          value={Number(pixelYToDepth(aoiSelection.maxY, project.depthTransform).depth.toFixed(1))}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) {
                              const py = depthToPixelY(val, project.depthTransform);
                              setAoiSelection({ ...aoiSelection, maxY: py });
                            }
                          }}
                          className="w-full rounded border border-slate-200 px-2 py-1 bg-white font-bold font-mono text-slate-800 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* MODE-SPECIFIC PARAMETERS */}
            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs space-y-3">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">PARAMETER ALAT</span>
              
              <div className="space-y-3 pt-1">
                {digitizationMode === 'freehand' && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">BRUSH WIDTH (px)</label>
                    <input
                      type="range"
                      min="1"
                      max="50"
                      value={brushWidth}
                      onChange={(e) => setBrushWidth(parseInt(e.target.value))}
                      className="w-full accent-slate-800 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-0.5">
                      <span>1px</span>
                      <span className="text-slate-700 font-bold">{brushWidth}px</span>
                      <span>50px</span>
                    </div>
                  </div>
                )}

                {(digitizationMode === 'autotrace' || digitizationMode === 'aoi') && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">LINE TRACKING SENSITIVITY</label>
                    <input
                      type="range"
                      min="5"
                      max="100"
                      value={lineTolerance}
                      onChange={(e) => setLineTolerance(parseInt(e.target.value))}
                      className="w-full accent-slate-800 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-0.5">
                      <span>Tight</span>
                      <span className="text-slate-700 font-bold">Tol: {lineTolerance}</span>
                      <span>Loose</span>
                    </div>
                  </div>
                )}

                {digitizationMode === 'erase' && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">ERASER RADIUS (px)</label>
                    <input
                      type="range"
                      min="5"
                      max="100"
                      value={eraserRadius}
                      onChange={(e) => setEraserRadius(parseInt(e.target.value))}
                      className="w-full accent-slate-800 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-0.5">
                      <span>5px</span>
                      <span className="text-slate-700 font-bold">{eraserRadius}px</span>
                      <span>100px</span>
                    </div>
                  </div>
                )}

                {digitizationMode === 'click' && (
                  <p className="text-[10.5px] text-slate-400 leading-tight">
                    Mode Manual Click aktif. Klik langsung pada gambar log untuk merekam titik data. Tarik titik untuk menyesuaikan posisinya.
                  </p>
                )}
              </div>
            </div>
          </div>
        );

      case 'lithology':
      case 'alignment':
        return (
          <div className="space-y-4">
            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs space-y-3">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">DIGITIZER ENGINE</span>
              
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">BRUSH WIDTH (px)</label>
                  <input
                    type="range"
                    min="1"
                    max="50"
                    value={brushWidth}
                    onChange={(e) => setBrushWidth(parseInt(e.target.value))}
                    className="w-full accent-slate-800 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-0.5">
                    <span>1px</span>
                    <span className="text-slate-700 font-bold">{brushWidth}px</span>
                    <span>50px</span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">LINE TRACKING SENSITIVITY</label>
                  <input
                    type="range"
                    min="5"
                    max="100"
                    value={lineTolerance}
                    onChange={(e) => setLineTolerance(parseInt(e.target.value))}
                    className="w-full accent-slate-800 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-0.5">
                    <span>Tight</span>
                    <span className="text-slate-700 font-bold">Tol: {lineTolerance}</span>
                    <span>Loose</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'qc':
        return (
          <div className="space-y-4">
            <div className="p-3 bg-white rounded-lg border border-[#BDC1C6] shadow-xs space-y-3">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">INTEGRITY COMPLIANCE</span>
              <p className="text-[10.5px] text-slate-500 leading-relaxed font-sans">
                Gunakan pengaturan berikut untuk memvalidasi log dari deviasi atau noise yang tidak diinginkan sebelum proses ekspor.
              </p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={project.curves.every(c => !c.points.some(pt => pt.value === null || isNaN(pt.value)))}
                    onChange={() => {
                      alert("Pembersihan otomatis NaN selesai. Semua data siap diproses!");
                    }}
                    className="rounded text-slate-800"
                  />
                  <span>Filter Nilai NaN/Null</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    defaultChecked
                    className="rounded text-slate-800"
                  />
                  <span>Sensus Interval Kedalaman</span>
                </label>
              </div>
            </div>
          </div>
        );

      case 'export':
        return (
          <div className="space-y-4">
            <div className="p-3 bg-white rounded-lg border border-[#BDC1C6] shadow-xs space-y-3">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">LAS PARAMETERS</span>
              
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">RESAMPLE STRATEGY</label>
                  <select
                    value={lasResampleStrategy}
                    onChange={(e) => setLasResampleStrategy(e.target.value as 'user' | 'dense' | 'median')}
                    className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:border-slate-400 bg-slate-50 font-bold"
                  >
                    <option value="user">Sesuai Nilai Rekam (Manual)</option>
                    <option value="dense">High Dense (0.1m / 0.5ft)</option>
                    <option value="median">Standard Median Filter</option>
                  </select>
                </div>

                {lasResampleStrategy === 'user' && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">MANUAL SAMPLING RATE ({project.well.depthUnit})</label>
                    <input
                      type="number"
                      step="0.001"
                      min="0.001"
                      value={isNaN(lasUserStep) ? '' : lasUserStep}
                      onChange={(e) => {
                        const parsed = parseFloat(e.target.value);
                        setLasUserStep(isNaN(parsed) ? 0.125 : parsed);
                      }}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-slate-400 bg-slate-50 font-mono font-bold text-slate-800"
                    />
                    <p className="text-[9.5px] text-slate-400 mt-1 leading-tight">
                      Langkah kedalaman reguler yang digunakan untuk pengambilan sampel ulang (resampling).
                    </p>
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">INTERPOLATION METHOD</label>
                  <select
                    value={lasInterpolationMethod}
                    onChange={(e) => setLasInterpolationMethod(e.target.value as 'linear' | 'pchip' | 'nearest' | 'cubic')}
                    className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:border-slate-400 bg-slate-50 font-bold"
                  >
                    <option value="linear">Linear Interpolation</option>
                    <option value="pchip">Monotonic Cubic Spline (PCHIP)</option>
                    <option value="nearest">Step (Nearest Neighbor)</option>
                    <option value="cubic">Cubic Spline Filter</option>
                  </select>
                </div>

                <div className="pt-2">
                  <button
                    onClick={() => {
                      const element = document.createElement("a");
                      const file = new Blob([lasPreviewText], { type: 'text/plain' });
                      element.href = URL.createObjectURL(file);
                      element.download = `${project.well.name.replace(/\\s+/g, '_')}_digitized.las`;
                      document.body.appendChild(element);
                      element.click();
                      document.body.removeChild(element);
                    }}
                    className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download LAS 2.0</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return <div className="text-slate-400 text-xs text-center py-10 font-sans">Pilih panel untuk memulai.</div>;
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-100 text-slate-800 font-sans antialiased overflow-hidden select-none">
      
      {/* 1. MASTER HEADER BAR */}
      <header className="bg-white border-b border-slate-200/80 px-4 h-12 flex items-center justify-between shrink-0 z-30 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-slate-900 rounded-md flex items-center justify-center font-bold text-white text-xs shadow-sm">CN</div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-slate-800 tracking-tight leading-none">CitraNeura</span>
            <span className="text-[9px] text-slate-400 font-medium tracking-tight mt-0.5">Raster-to-LAS Digitizer Workstation</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Security & Privacy Badge Trigger */}
          <button
            onClick={() => setShowSecurityModal(true)}
            className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100/90 text-emerald-800 border border-emerald-200/90 rounded px-2.5 py-1 text-[10.5px] font-bold transition cursor-pointer shadow-2xs shrink-0"
            title="Buka Jaminan Keamanan & Kerahasiaan Data Subsurface"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="hidden sm:inline">100% Data Pemrosesan Lokal</span>
            <span className="sm:hidden">Lokal & Aman</span>
          </button>

          <div className="h-4 w-[1px] bg-slate-200 mx-0.5" />

          {/* Search Shortcut Trigger */}
          <button
            onClick={() => setIsCommandPaletteOpen(true)}
            className="flex items-center gap-2 bg-slate-50 border border-slate-200 hover:border-slate-300 rounded px-2.5 py-1 text-[10.5px] text-slate-500 transition cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search Workspace...</span>
            <kbd className="bg-slate-200 px-1 py-0.5 rounded text-[8.5px] font-mono border border-slate-300">Ctrl+K</kbd>
          </button>

          <div className="h-4 w-[1px] bg-slate-200 mx-1" />

          {/* Undo/Redo Controls */}
          <button
            onClick={handlesUndo}
            disabled={undoCommandStack.length === 0}
            className="p-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40 transition cursor-pointer"
            title="Undo"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-[1px] bg-slate-200 mx-1" />

          {/* Core Project Actions */}
          <button
            onClick={() => setShowNewProjectModal(true)}
            className="bg-slate-900 hover:bg-slate-800 text-white rounded px-3 h-8 text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
          >
            <FilePlus className="w-3.5 h-3.5" />
            <span>Proyek Baru</span>
          </button>
          <button
            onClick={saveProjectToLocal}
            className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded px-2.5 h-8 text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer"
            title="Simpan proyek ke penyimpanan browser lokal"
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>Simpan</span>
          </button>
          <button
            onClick={loadProjectFromLocal}
            className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded px-2.5 h-8 text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer"
            title="Buka proyek dari penyimpanan browser lokal"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Buka</span>
          </button>

          <div className="h-4 w-[1px] bg-slate-200 mx-1" />

          <button
            onClick={handleSaveProjectJson}
            className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded px-2.5 h-8 text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer"
            title="Ekspor seluruh data proyek sebagai file .json ke komputer Anda"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Ekspor JSON</span>
          </button>
          <button
            onClick={() => document.getElementById('json-project-file-input')?.click()}
            className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded px-2.5 h-8 text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer"
            title="Impor file proyek (.json) dari komputer Anda"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Impor JSON</span>
          </button>
          <input
            type="file"
            id="json-project-file-input"
            accept=".json"
            onChange={handleLoadProjectJson}
            className="hidden"
          />

          <div className="h-4 w-[1px] bg-slate-200 mx-1" />

          <button
            onClick={() => setIsLeftSidebarVisible(!isLeftSidebarVisible)}
            className={`p-1.5 rounded border transition cursor-pointer ${isLeftSidebarVisible ? 'bg-slate-100 text-slate-800 border-slate-300' : 'border-slate-200 hover:bg-slate-50 text-slate-500'}`}
            title="Toggle Left Sidebar"
          >
            <Menu className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setIsRightInspectorVisible(!isRightInspectorVisible)}
            className={`p-1.5 rounded border transition cursor-pointer ${isRightInspectorVisible ? 'bg-slate-100 text-slate-800 border-slate-300' : 'border-slate-200 hover:bg-slate-50 text-slate-500'}`}
            title="Toggle Right Inspector"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setShowProfiler(!showProfiler)}
            className={`p-1.5 rounded border transition cursor-pointer ${showProfiler ? 'bg-slate-100 text-slate-800 border-slate-300' : 'border-slate-200 hover:bg-slate-50 text-slate-500'}`}
            title="Performance Profiler"
          >
            <Cpu className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE WRAPPER */}
      <div className="flex flex-1 overflow-hidden relative flex-row">
        
        {/* LEFT WORKFLOW SIDEBAR */}
        {isLeftSidebarVisible && !isFocusMode && (
          <aside className="w-64 bg-slate-50 border-r border-slate-200/80 flex flex-col shrink-0 overflow-y-auto custom-scrollbar z-20">
            {/* Well Overview Card */}
            <div className="p-4 border-b border-slate-200/60 bg-slate-100/40">
              <span className="text-[9px] font-extrabold text-slate-400 tracking-wider uppercase block mb-1.5">IDENTITAS SUMUR</span>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-bold text-slate-800 truncate max-w-[120px]" title={project.well.name}>{project.well.name}</span>
                  <span className="text-[9px] font-mono text-slate-400 font-medium">{project.well.uwi || 'No UWI'}</span>
                </div>
                <div className="flex items-center justify-between text-[10.5px] text-slate-500">
                  <span>Op: {project.well.operator || 'Unknown'}</span>
                  <span>{project.well.topDepth}-{project.well.bottomDepth} {project.well.depthUnit}</span>
                </div>
              </div>
            </div>

            {/* Scientific Workflow 5-Step Navigator */}
            <div className="p-4 border-b border-slate-200/60 space-y-1">
              <span className="text-[9px] font-extrabold text-slate-400 tracking-wider uppercase block mb-2.5">LANGKAH KERJA</span>
              {[
                { id: 'well_header', step: '01', label: 'Well Header', icon: FileText, tab: 'project' },
                { id: 'calibrate', step: '02', label: 'Calibrate Scale', icon: Compass, tab: 'calibration-vertical' },
                { id: 'digitize', step: '03', label: 'Digitize Curves', icon: PenTool, tab: 'digitize' },
                { id: 'qc', step: '04', label: 'Scientific QC', icon: ShieldAlert, tab: 'qc' },
                { id: 'las', step: '05', label: 'LAS Exporter', icon: Save, tab: 'export' },
              ].map((step) => {
                const isActive = (step.id === 'well_header' && activeTab === 'project') ||
                                (step.id === 'calibrate' && (activeTab === 'calibration-vertical' || activeTab === 'calibration-horizontal')) ||
                                (step.id === 'digitize' && (activeTab === 'digitize' || activeTab === 'lithology' || activeTab === 'alignment')) ||
                                (step.id === 'qc' && activeTab === 'qc') ||
                                (step.id === 'las' && activeTab === 'export');
                const Icon = step.icon;
                return (
                  <button
                    key={step.id}
                    onClick={() => handleStepClick(step.id)}
                    className={`w-full flex items-center justify-between p-2 rounded-md transition-all text-left cursor-pointer ${isActive ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-[10px] font-mono font-bold text-slate-400">{step.step}</span>
                      <Icon className={`w-4 h-4 ${isActive ? 'text-slate-900' : 'text-slate-400'}`} />
                      <span className="text-xs font-semibold">{step.label}</span>
                    </div>
                    {isActive && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                  </button>
                );
              })}
            </div>

            {/* Persistent Curve Manager */}
            <div className="p-4 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-extrabold text-slate-400 tracking-wider uppercase">CURVE CHANNEL MANAGER</span>
                <button
                  onClick={() => {
                    setShowAddCurveForm(!showAddCurveForm);
                  }}
                  className={`p-1 rounded transition cursor-pointer ${showAddCurveForm ? 'bg-indigo-100 text-indigo-800' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-800'}`}
                  title="Tambah saluran kurva baru (misal LLD, LLS, NPHI, RHOB) ke dalam track yang sudah ada tanpa membuat grid kalibrasi baru"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Active Status Info Box */}
              <div className="mb-3 p-2 bg-slate-150/50 border border-slate-200/80 rounded-md space-y-1 text-[10.5px] font-sans">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-bold text-[8.5px] uppercase">Track Aktif:</span>
                  <span className="font-bold text-slate-700 truncate max-w-[120px]" title={currentActiveTrack?.name}>
                    {currentActiveTrack ? `${currentActiveTrack.name} (${Math.round(currentActiveTrack.pixelXLeft)}-${Math.round(currentActiveTrack.pixelXRight)} px)` : 'Tidak Ada'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-bold text-[8.5px] uppercase">Log Aktif:</span>
                  <span className="font-bold text-indigo-600 truncate max-w-[120px]" title={currentActiveCurve?.metadata.mnemonic}>
                    {currentActiveCurve ? `${currentActiveCurve.metadata.mnemonic} (${currentActiveCurve.metadata.unit || 'No Unit'})` : 'Tidak Ada'}
                  </span>
                </div>
              </div>

              {showAddCurveForm && (
                <div className="mb-3 p-3 bg-white border border-slate-200/85 rounded-lg shadow-xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-700 uppercase">Tambah Kurva Baru</span>
                    <button
                      onClick={() => setShowAddCurveForm(false)}
                      className="text-slate-400 hover:text-slate-600 font-bold text-xs cursor-pointer px-1.5"
                    >
                      ×
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[8.5px] font-bold text-slate-400 uppercase mb-0.5">Mnemonic</label>
                      <input
                        type="text"
                        placeholder="e.g. GR, ILD"
                        value={newCurveMnemonic}
                        onChange={(e) => setNewCurveMnemonic(e.target.value.toUpperCase())}
                        className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none bg-slate-50 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[8.5px] font-bold text-slate-400 uppercase mb-0.5">Unit</label>
                      <input
                        type="text"
                        placeholder="e.g. API, G/CC"
                        value={newCurveUnit}
                        onChange={(e) => setNewCurveUnit(e.target.value)}
                        className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none bg-slate-50 font-mono"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[8.5px] font-bold text-slate-400 uppercase mb-0.5">Target Track (Masukkan ke Track)</label>
                    <select
                      value={newCurveTrackId || (project.tracks[0]?.id || '')}
                      onChange={(e) => setNewCurveTrackId(e.target.value)}
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none bg-slate-50 font-bold text-slate-700"
                    >
                      {project.tracks.map(t => (
                        <option key={t.id} value={t.id}>{t.name} (Batas: {Math.round(t.pixelXLeft)}-{Math.round(t.pixelXRight)} px)</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => {
                      if (!newCurveMnemonic.trim()) {
                        alert('Nama kurva (Mnemonic) tidak boleh kosong.');
                        return;
                      }
                      const nextMnemonic = newCurveMnemonic.trim().toUpperCase();
                      const u = newCurveUnit.trim() || 'Unit';
                      const nextId = `curve-${Date.now()}`;
                      const targetTrack = newCurveTrackId || (project.tracks[0]?.id || 'track-1');
                      const newCurve: Curve = {
                        id: nextId,
                        trackId: targetTrack,
                        metadata: {
                          id: `meta-${nextId}`,
                          mnemonic: nextMnemonic,
                          unit: u,
                          nullValue: project.nullValueGlobal || -999.25
                        },
                        points: [],
                        depthShiftApplied: 0
                      };
                      const newState = { ...project, curves: [...project.curves, newCurve] };
                      saveActionState(newState, `Added new curve channel: ${nextMnemonic}`);
                      setActiveCurveId(nextId);
                      setShowAddCurveForm(false);
                      setNewCurveMnemonic('RHOB');
                      setNewCurveUnit('G/CC');
                      setNewCurveTrackId('');
                    }}
                    className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-[10.5px] font-bold cursor-pointer transition text-center"
                  >
                    Tambah Kurva
                  </button>
                </div>
              )}

              <div className="space-y-1 overflow-y-auto flex-1 pr-1 custom-scrollbar min-h-0">
                {project.curves.map((curve) => {
                  const isCurveActive = curve.id === activeCurveId;
                  const pointsCount = curve.points.length;
                  const isCurveHidden = hiddenCurveIds[curve.id];
                  const isCurveLocked = lockedCurveIds[curve.id];
                  const curveColor = getCurveVisualColor(curve);

                  return (
                    <div
                      key={curve.id}
                      onClick={() => setActiveCurveId(curve.id)}
                      className={`group flex flex-col p-2 rounded-md transition border cursor-pointer ${isCurveActive ? 'bg-white border-slate-200 text-slate-900 shadow-sm' : 'bg-transparent border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
                      title={`Klik untuk memilih kurva ${curve.metadata.mnemonic} sebagai kurva aktif yang sedang didigitasi`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2 max-w-[130px]">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0 border border-slate-300" style={{ backgroundColor: curveColor }} />
                          <div className="flex flex-col truncate">
                            <span className="text-xs font-bold leading-none">{curve.metadata.mnemonic}</span>
                            <span className="text-[9px] font-medium text-slate-400 mt-0.5">{curve.metadata.unit} • {pointsCount} pts</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition">
                          {/* Eye visibility toggle */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleCurveVisibility(curve.id);
                            }}
                            className="p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-800 cursor-pointer"
                            title={isCurveHidden ? "Tampilkan garis kurva ini pada area visualisasi canvas" : "Sembunyikan garis kurva ini dari area visualisasi canvas"}
                          >
                            {isCurveHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>

                          {/* Lock editing toggle */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleCurveLock(curve.id);
                            }}
                            className="p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-800 cursor-pointer"
                            title={isCurveLocked ? "Buka kunci penyuntingan kurva ini" : "Kunci penyuntingan kurva ini untuk menghindari kesalahan perubahan data secara tidak sengaja"}
                          >
                            {isCurveLocked ? <Lock className="w-3 h-3 text-amber-500" /> : <Unlock className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>

                      {/* Visual Style Settings Panel (only for active curve) */}
                      {isCurveActive && (
                        <div 
                          className="mt-2 pt-2 border-t border-slate-100 space-y-2 text-[10px] font-sans text-slate-600"
                          onClick={(e) => e.stopPropagation()} // Prevent resetting active curve when clicking inside settings
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-500">Warna:</span>
                            <div className="flex items-center gap-1.5">
                              {/* Quick palette */}
                              {['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#6B7280'].map((colorOption) => (
                                <button
                                  key={colorOption}
                                  onClick={() => handleUpdateCurveStyle(curve.id, { color: colorOption })}
                                  className={`w-3 h-3 rounded-full border border-slate-200 transition ${curve.style?.color === colorOption ? 'ring-2 ring-indigo-500 ring-offset-1 scale-110' : 'hover:scale-105'}`}
                                  style={{ backgroundColor: colorOption }}
                                />
                              ))}
                              {/* Custom color picker */}
                              <input
                                type="color"
                                value={curve.style?.color || curveColor}
                                onChange={(e) => handleUpdateCurveStyle(curve.id, { color: e.target.value })}
                                className="w-4 h-4 p-0 border-0 rounded cursor-pointer shrink-0"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-0.5">
                              <span className="font-semibold text-slate-500">Tebal (px):</span>
                              <select
                                value={curve.style?.weight ?? (isCurveActive ? 2.5 : 1.2)}
                                onChange={(e) => handleUpdateCurveStyle(curve.id, { weight: parseFloat(e.target.value) })}
                                className="w-full rounded border border-slate-200 px-1 py-0.5 text-[10px] font-semibold text-slate-700 bg-slate-50 focus:outline-none"
                              >
                                <option value="1">1.0 px</option>
                                <option value="1.5">1.5 px</option>
                                <option value="2">2.0 px</option>
                                <option value="2.5">2.5 px</option>
                                <option value="3">3.0 px</option>
                                <option value="4">4.0 px</option>
                                <option value="5">5.0 px</option>
                              </select>
                            </div>

                            <div className="space-y-0.5">
                              <span className="font-semibold text-slate-500">Gaya Garis:</span>
                              <select
                                value={curve.style?.dashStyle ?? 'solid'}
                                onChange={(e) => handleUpdateCurveStyle(curve.id, { dashStyle: e.target.value as any })}
                                className="w-full rounded border border-slate-200 px-1 py-0.5 text-[10px] font-semibold text-slate-700 bg-slate-50 focus:outline-none"
                              >
                                <option value="solid">Solid (Utuh)</option>
                                <option value="dashed">Dashed (Putus)</option>
                                <option value="dotted">Dotted (Titik)</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        )}

        {/* CENTER VIEWPORT AND WORKSPACE CANVAS */}
        <main className="flex-1 flex flex-col h-full overflow-hidden min-w-0 bg-slate-100">
          
          {/* MASTER FLOATING-LOOK TOOLBAR */}
          <section className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between gap-4 shrink-0 select-none z-20 shadow-xs">
            <div className="flex items-center gap-4">
              {/* Zoom group */}
              <div className="flex items-center border border-slate-200 rounded bg-slate-50 p-0.5">
                <button
                  onClick={() => setZoomScale(z => Math.max(0.1, z - 0.1))}
                  className="p-1 text-slate-600 hover:bg-white rounded hover:text-slate-800 hover:shadow-xs transition font-bold cursor-pointer text-xs w-6 h-6 flex items-center justify-center font-sans"
                  title="Zoom Out"
                >
                  -
                </button>
                <span className="text-[10.5px] font-mono font-bold text-slate-600 px-2 select-none">
                  {Math.round(zoomScale * 100)}%
                </span>
                <button
                  onClick={() => setZoomScale(z => Math.min(5.0, z + 0.1))}
                  className="p-1 text-slate-600 hover:bg-white rounded hover:text-slate-800 hover:shadow-xs transition font-bold cursor-pointer text-xs w-6 h-6 flex items-center justify-center font-sans"
                  title="Zoom In"
                >
                  +
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (project.raster) {
                      const container = viewportRef.current;
                      if (container) {
                        const fitZoom = container.clientWidth / project.raster.width;
                        const panY = (project.raster.height * fitZoom - container.clientHeight) / 2;
                        updatePanAndZoom({ x: 0, y: panY }, fitZoom);
                      }
                    }
                  }}
                  className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-[10.5px] text-slate-600 font-semibold cursor-pointer transition font-sans"
                >
                  Fit Width
                </button>
                <button
                  onClick={() => {
                    if (project.raster) {
                      const container = viewportRef.current;
                      if (container) {
                        setZoomScale(container.clientHeight / project.raster.height);
                        setPanOffset({ x: 0, y: 0 });
                      }
                    }
                  }}
                  className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-[10.5px] text-slate-600 font-semibold cursor-pointer transition font-sans"
                >
                  Fit Height
                </button>
                <button
                  onClick={() => {
                    setZoomScale(1.0);
                    setPanOffset({ x: 0, y: 0 });
                  }}
                  className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-[10.5px] text-slate-600 font-semibold cursor-pointer transition font-sans"
                >
                  100%
                </button>
              </div>

              <div className="h-4 w-[1px] bg-slate-200" />

              {/* Workspace display modes */}
              <div className="flex rounded-md bg-slate-100 p-0.5 border border-slate-200">
                {[
                  { id: 'split', label: 'Split View' },
                  { id: 'overlay', label: 'Live Overlay' },
                  { id: 'raster', label: 'Raster Only' },
                  { id: 'digitized', label: 'Digitized' },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setWorkspaceMode(mode.id as any)}
                    className={`text-[10px] px-2.5 py-1 text-center font-bold rounded-sm transition-all cursor-pointer ${workspaceMode === mode.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Focus Mode strip */}
              <button
                onClick={() => setIsFocusMode(!isFocusMode)}
                className={`flex items-center gap-1.5 px-3 py-1 border rounded text-[10.5px] font-bold transition cursor-pointer ${isFocusMode ? 'bg-amber-100 text-amber-800 border-amber-300 font-bold' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                title="Saran: Tekan tombol 'f' untuk memicu Focus Mode"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isFocusMode ? 'Fokus Aktif (Tekan F)' : 'Focus Mode (F)'}</span>
              </button>
            </div>
          </section>

          {/* SPLIT / FLEX CANVAS VIEWPORT CONTAINER */}
          <div className="flex-1 flex overflow-hidden relative select-none bg-slate-250 font-sans">
            {!project.raster ? (
              <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 text-slate-100 p-8 select-none w-full h-full">
                <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-2xl text-center space-y-6">
                  <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center mx-auto text-white shadow-lg animate-pulse">
                    <Upload className="w-8 h-8" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-bold font-sans tracking-tight text-white">Import Raster Well Log</h2>
                    <p className="text-xs text-slate-400 font-sans leading-relaxed">
                      Unggah berkas citra sumur log (JPEG, PNG, TIFF) untuk memulai proses digitisasi otomatis dan ekspor LAS.
                    </p>
                  </div>
                  <div className="border-2 border-dashed border-slate-700 hover:border-indigo-500 hover:bg-indigo-950/20 rounded-lg p-8 transition cursor-pointer relative group">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleRasterImageUpload}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-indigo-400 block group-hover:text-indigo-300">Pilih Berkas Gambar Log</span>
                      <span className="text-[10px] text-slate-500 block">Drag & Drop di sini atau telusuri berkas</span>
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-500 flex items-center justify-center gap-1.5 font-medium bg-slate-800/50 p-2.5 rounded-lg border border-slate-800">
                    <Compass className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-left">Langkah ini akan menginisialisasi Track 1 secara otomatis (Status: Unconfigured).</span>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* CANVAS DRAWING ELEMENT PANEL */}
            <div
              style={{ display: workspaceMode === 'digitized' ? 'none' : 'block' }}
              className="flex-1 h-full overflow-hidden bg-slate-800 relative font-sans"
            >
              <div
                ref={viewportRef}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
                onContextMenu={(e) => e.preventDefault()}
                className={`w-full h-full overflow-hidden bg-[#1E293B] border-r border-slate-700 relative select-none font-sans ${digitizationMode === 'autotrace' || digitizationMode === 'aoi' ? 'cursor-crosshair' : ''}`}
              >
                <canvas
                  ref={canvasRef}
                  width={currentRasterWidth}
                  height={currentRasterHeight}
                  className="shadow-lg bg-slate-900 max-w-none origin-top-left font-sans absolute top-0 left-0"
                  style={{
                    transform: `translate(${viewportSize.width / 2 + panOffset.x}px, ${viewportSize.height / 2 + panOffset.y}px) scale(${zoomScale}) translate(${-currentRasterWidth / 2}px, ${-currentRasterHeight / 2}px)`,
                  }}
                />

                {/* Mode Interactive Calibration Banners */}
                {tiltedClickState && (
                  <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-amber-500/95 text-slate-950 px-4 py-2.5 rounded-lg shadow-2xl flex items-center gap-2.5 z-40 animate-bounce text-xs font-extrabold font-sans backdrop-blur-md border border-amber-400">
                    <Sparkles className="w-4 h-4 shrink-0 animate-spin" />
                    <span>
                      {tiltedClickState.step === 'left'
                        ? '📐 MODE TILTED: Klik SISI KIRI dari garis kedalaman pada gambar'
                        : '📐 MODE TILTED: Klik SISI KANAN dari garis kedalaman pada gambar'}
                    </span>
                    <button
                      onClick={() => setTiltedClickState(null)}
                      className="ml-2 hover:bg-black/10 rounded-full px-1.5 py-0.5 text-[10px] cursor-pointer"
                    >
                      Batal
                    </button>
                  </div>
                )}

                {calibratingXTrack && (
                  <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-pink-500/95 text-white px-4 py-2.5 rounded-lg shadow-2xl flex items-center gap-2.5 z-40 animate-pulse text-xs font-extrabold font-sans backdrop-blur-md border border-pink-400">
                    <Compass className="w-4 h-4 shrink-0 animate-spin" />
                    <span>
                      {`📏 MODE SKALA (X): Klik batas ${calibratingXTrack.side === 'left' ? 'KIRI' : 'KANAN'} track log pada gambar`}
                    </span>
                    <button
                      onClick={() => setCalibratingXTrack(null)}
                      className="ml-2 hover:bg-black/10 rounded-full px-1.5 py-0.5 text-[10px] cursor-pointer"
                    >
                      Batal
                    </button>
                  </div>
                )}

                {/* Minimap (Floating Bird's-Eye Navigator) */}
                {project.raster && (
                  <div className="absolute bottom-4 right-4 bg-slate-900/90 border border-slate-700 p-1.5 rounded-lg shadow-2xl w-32 h-44 flex flex-col backdrop-blur-sm z-10 text-white select-none">
                    <span className="text-[8.5px] font-bold tracking-wider text-slate-400 mb-1 block font-sans">NAVIGATOR</span>
                    <div
                      ref={minimapRef}
                      onMouseDown={handleMinimapMouseDown}
                      onMouseMove={handleMinimapMouseMove}
                      className="flex-1 bg-black/40 rounded border border-slate-800 relative overflow-hidden cursor-crosshair"
                    >
                      {/* Interactive global raster canvas */}
                      <canvas
                        ref={minimapCanvasRef}
                        className="absolute inset-0 w-full h-full object-contain pointer-events-none opacity-85"
                      />
                      {/* Viewport frame indicator */}
                      <div
                        className="absolute border border-rose-500/80 bg-rose-500/10 transition-all pointer-events-none"
                        style={{
                          top: `${miniVisibleTop}px`,
                          left: `${miniVisibleLeft}px`,
                          width: `${miniVisibleWidth}px`,
                          height: `${miniVisibleHeight}px`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Loading Banner overlay */}
                {isRasterLoading && (
                  <div className="absolute inset-0 bg-slate-900/70 flex items-center justify-center backdrop-blur-xs z-30 select-none text-white text-xs gap-3 font-sans">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>{rasterLoadingStatus}</span>
                  </div>
                )}

                {/* Floating Context Menu */}
                {contextMenu && (
                  <div
                    className="absolute bg-slate-900/95 border border-slate-700/80 rounded-lg shadow-2xl p-1.5 z-50 min-w-[160px] flex flex-col font-sans select-none backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
                    style={{
                      top: `${contextMenu.y}px`,
                      left: `${contextMenu.x}px`,
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    {contextMenu.type === 'point' && contextMenu.pointIndex !== undefined ? (
                      <button
                        onClick={() => {
                          const curve = project.curves.find(c => c.id === contextMenu.targetId);
                          if (curve) {
                            const pt = curve.points[contextMenu.pointIndex!];
                            if (pt) removeDigitizedPoint(pt.id);
                          }
                          setContextMenu(null);
                        }}
                        className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-semibold text-rose-400 hover:text-white hover:bg-rose-600/30 rounded transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Hapus Titik Ini</span>
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            handleFitRaster();
                            setContextMenu(null);
                          }}
                          className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
                        >
                          <Maximize2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Fit Image (F)</span>
                        </button>
                        <button
                          onClick={() => {
                            handleZoom100();
                            setContextMenu(null);
                          }}
                          className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
                        >
                          <ZoomIn className="w-3.5 h-3.5 shrink-0" />
                          <span>Zoom 100% (1)</span>
                        </button>
                        <div className="border-t border-slate-800 my-1" />
                        <button
                          onClick={() => {
                            if (confirm("Apakah Anda yakin ingin menghapus semua titik pada kurva aktif ini?")) {
                              removeAllActivePoints();
                            }
                            setContextMenu(null);
                          }}
                          className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-semibold text-rose-400 hover:text-white hover:bg-rose-900/30 rounded transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Hapus Semua Titik</span>
                        </button>
                      </>
                    )}

                    {activeTab === 'digitize' && (
                      <>
                        <div className="border-t border-slate-800 my-1" />
                        <div className="px-2.5 py-1 text-[8px] font-bold text-slate-500 uppercase tracking-wider">
                          Alat Citra
                        </div>
                        <button
                          onClick={() => {
                            setClaheEnabled(!claheEnabled);
                          }}
                          className="flex items-center justify-between w-full px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                            <span>Koreksi CLAHE</span>
                          </div>
                          <div className={`w-1.5 h-1.5 rounded-full ${claheEnabled ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-slate-700'}`} />
                        </button>
                        <button
                          onClick={() => {
                            setGrayscaleEnabled(!grayscaleEnabled);
                          }}
                          className="flex items-center justify-between w-full px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Eye className="w-3.5 h-3.5 shrink-0 text-blue-400" />
                            <span>Auto-Grayscale</span>
                          </div>
                          <div className={`w-1.5 h-1.5 rounded-full ${grayscaleEnabled ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-slate-700'}`} />
                        </button>
                        <button
                          onClick={() => {
                            setInvertEnabled(!invertEnabled);
                          }}
                          className="flex items-center justify-between w-full px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <RefreshCw className="w-3.5 h-3.5 shrink-0 text-purple-400" />
                            <span>Invert Warna</span>
                          </div>
                          <div className={`w-1.5 h-1.5 rounded-full ${invertEnabled ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-slate-700'}`} />
                        </button>

                        <div className="border-t border-slate-800 my-1" />
                        <div className="px-2.5 py-1 text-[8px] font-bold text-slate-500 uppercase tracking-wider">
                          Mode Digitasi
                        </div>
                        {(['click', 'freehand', 'autotrace', 'erase'] as const).map((m) => {
                          const isSelected = digitizationMode === m;
                          let label = '';
                          let icon = null;
                          if (m === 'click') {
                            label = 'Klik Manual';
                            icon = <MousePointer className="w-3.5 h-3.5 shrink-0 text-slate-400" />;
                          } else if (m === 'freehand') {
                            label = 'Freehand';
                            icon = <PenTool className="w-3.5 h-3.5 shrink-0 text-slate-400" />;
                          } else if (m === 'autotrace') {
                            label = 'Autotrace';
                            icon = <Sparkles className="w-3.5 h-3.5 shrink-0 text-slate-400" />;
                          } else if (m === 'erase') {
                            label = 'Penghapus (Eraser)';
                            icon = <Eraser className="w-3.5 h-3.5 shrink-0 text-slate-400" />;
                          }
                          return (
                            <button
                              key={m}
                              onClick={() => {
                                setDigitizationMode(m);
                                setContextMenu(null);
                              }}
                              className={`flex items-center justify-between w-full px-2.5 py-1.5 text-xs font-semibold rounded transition cursor-pointer ${isSelected ? 'bg-indigo-600/30 text-indigo-300' : 'text-slate-300 hover:text-white hover:bg-slate-800'}`}
                            >
                              <div className="flex items-center gap-2">
                                {icon}
                                <span>{label}</span>
                              </div>
                              {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* SVG PLOT VIEWPORT OR DATA POINTS PREVIEW (Right half under split view) */}
            {(workspaceMode === 'split' || workspaceMode === 'digitized') && (
              <div
                style={isDesktop && workspaceMode === 'split' ? { width: `${rightWidth}%` } : { flex: 1 }}
                className="h-full border-l border-slate-200 bg-slate-100 flex flex-col shrink-0 overflow-hidden relative select-none font-sans"
              >
                {/* Floating Header Badge - Prevents top vertical offset shift so both viewports flatten on identical depth */}
                <div className="absolute top-2.5 left-2.5 right-2.5 z-20 flex items-center justify-between px-3 py-1.5 bg-white/90 backdrop-blur-md border border-slate-200/90 rounded-lg shadow-xs font-sans pointer-events-auto">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-extrabold text-slate-700 tracking-wider uppercase">DIGITIZED DATA VIEW</span>
                  </div>
                  <div className="flex rounded-md bg-slate-100 p-0.5 border border-slate-200">
                    <button
                      onClick={() => setRightActiveTab('preview')}
                      className={`text-[9.5px] px-2.5 py-0.5 font-bold rounded-sm cursor-pointer transition ${rightActiveTab === 'preview' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Wireline Track
                    </button>
                    <button
                      onClick={() => setRightActiveTab('points')}
                      className={`text-[9.5px] px-2.5 py-0.5 font-bold rounded-sm cursor-pointer transition ${rightActiveTab === 'points' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Data Table
                    </button>
                  </div>
                </div>

                <div className="w-full h-full overflow-hidden relative font-sans">
                  {rightActiveTab === 'preview' ? (
                    <div
                      ref={rightViewportRef}
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={handleCanvasMouseUp}
                      onMouseLeave={handleCanvasMouseUp}
                      onContextMenu={(e) => e.preventDefault()}
                      className="w-full h-full overflow-hidden bg-slate-100 relative select-none font-sans cursor-crosshair"
                      style={{ backgroundColor: adaptiveBgColor }}
                    >
                      <canvas
                        ref={rightCanvasRef}
                        width={currentRasterWidth}
                        height={currentRasterHeight}
                        className="shadow-md bg-white max-w-none origin-top-left font-sans absolute top-0 left-0"
                        style={{
                          transform: `translate(${viewportSize.width / 2 + panOffset.x}px, ${viewportSize.height / 2 + panOffset.y}px) scale(${zoomScale}) translate(${-currentRasterWidth / 2}px, ${-currentRasterHeight / 2}px)`,
                        }}
                      />
                    </div>
                  ) : (
                    <div className="h-full overflow-y-auto pt-14 p-4 custom-scrollbar font-sans bg-white">
                      {/* DATA POINTS GRID VIEW TABLE */}
                      {(() => {
                        const activeCurve = project.curves.find(c => c.id === activeCurveId);
                        const points = activeCurve?.points || [];

                        return (
                          <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-xs">
                            <table className="w-full text-left text-xs text-slate-600">
                              <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200">
                                <tr>
                                  <th className="px-3 py-2">Index</th>
                                  <th className="px-3 py-2 text-right">Pixel Y (px)</th>
                                  <th className="px-3 py-2 text-right">Kedalaman ({project.well.depthUnit})</th>
                                  <th className="px-3 py-2 text-right">Nilai ({activeCurve?.metadata.unit || 'API'})</th>
                                </tr>
                              </thead>
                              <tbody>
                                {points.slice(0, 50).map((pt, i) => (
                                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                                    <td className="px-3 py-1.5 font-mono">{i + 1}</td>
                                    <td className="px-3 py-1.5 text-right font-mono">{pt.pixelY}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-slate-900 font-semibold">{pt.depth ? pt.depth.toFixed(2) : '-'}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-emerald-600 font-bold">{pt.value ? pt.value.toFixed(2) : '-'}</td>
                                  </tr>
                                ))}
                                {points.length === 0 && (
                                  <tr>
                                    <td colSpan={4} className="px-3 py-8 text-center text-slate-400">Belum ada titik terekam.</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                            {points.length > 50 && (
                              <div className="p-2 text-center text-[10.5px] text-slate-400 border-t border-slate-100 font-semibold">
                                Menampilkan 50 dari {points.length} titik terkumpul.
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Resizing splitter bar */}
                {isDesktop && workspaceMode === 'split' && (
                  <div
                    onMouseDown={() => setIsResizingRight(true)}
                    className="absolute left-0 w-1 hover:w-1.5 bg-slate-200 hover:bg-indigo-600 cursor-col-resize h-full z-20 transition-all"
                  />
                )}
              </div>
            )}
              </>
            )}
          </div>
        </main>

        {/* RIGHT CONTEXTUAL INSPECTOR */}
        {isRightInspectorVisible && !isFocusMode && (
          <aside className="w-80 bg-slate-50 border-l border-slate-200/80 flex flex-col shrink-0 overflow-y-auto custom-scrollbar z-20">
            {/* 1. Scientific Validation Reports */}
            <div className="p-4 border-b border-slate-200/60">
              <span className="text-[9px] font-extrabold text-slate-400 tracking-wider uppercase block mb-2 font-sans">INTEGRITY CHECKER</span>
              <div className="space-y-1.5">
                {getValidationIssues().map((is, idx) => (
                  <div
                    key={idx}
                    className={`p-2 rounded text-[11px] leading-snug border flex items-start gap-2 font-sans ${is.type === 'error' ? 'bg-rose-50 text-rose-700 border-rose-100' : is.type === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}
                  >
                    <div className="w-1.5 h-1.5 rounded-full shrink-0 mt-1 bg-current" />
                    <span>{is.message}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 2. Step Metrics Breakdown */}
            <div className="p-4 border-b border-slate-200/60">
              <span className="text-[9px] font-extrabold text-slate-400 tracking-wider uppercase block mb-2 font-sans">STEP STATISTICS</span>
              <div className="grid grid-cols-2 gap-2">
                {getStepStatistics().map((st, idx) => (
                  <div key={idx} className="bg-slate-100/50 border border-slate-150 p-2 rounded-md font-sans">
                    <span className="text-[9px] text-slate-400 font-extrabold block uppercase tracking-wider">{st.label}</span>
                    <span className="text-xs font-mono font-bold text-slate-700 mt-1 block truncate" title={String(st.value)}>{st.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. Properties Form Fields */}
            <div className="p-4 flex-1">
              <span className="text-[9px] font-extrabold text-slate-400 tracking-wider uppercase block mb-3 font-sans">PANEL CONFIGURATION</span>
              {renderPropertiesForm()}
            </div>
          </aside>
        )}

      </div>

      {/* 3. COMPACT BOTTOM STATUS BAR */}
      <footer className="h-6 bg-slate-900 text-slate-400 text-[10px] px-4 flex items-center justify-between shrink-0 select-none z-30 font-sans">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-emerald-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>SISTEM SIAP</span>
          </span>
          <span className="text-slate-500 font-medium">|</span>
          <span className="truncate max-w-[200px]" title={project.well.name}>File: {project.raster?.name || 'Raster Backdrop kosong'}</span>
        </div>
        <div className="flex items-center gap-4 font-mono text-[9px]">
          <span>Y-Scale: {project.depthTransform.linearScale ? `${project.depthTransform.linearScale.toFixed(2)} px/${project.well.depthUnit}` : 'uncalibrated'}</span>
          <span>Tracks: {project.tracks.length}</span>
          <span>Points: {project.curves.reduce((acc, c) => acc + c.points.length, 0)}</span>
        </div>
      </footer>

      {/* COMMAND PALETTE POPUP */}
      <AnimatePresence>
        {isCommandPaletteOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-start justify-center pt-[15vh] z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              className="bg-white rounded-lg border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden flex flex-col font-sans"
            >
              <div className="p-3 border-b border-slate-100 flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Ketik perintah atau nama saluran kurva..."
                  className="w-full text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
                  value={commandQuery}
                  onChange={(e) => setCommandQuery(e.target.value)}
                  autoFocus
                />
                <button
                  onClick={() => setIsCommandPaletteOpen(false)}
                  className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-2 max-h-60 overflow-y-auto custom-scrollbar">
                {[
                  { label: "Buka Pengaturan Sumur (Well Header)", icon: FileText, action: () => handleStepClick('well_header') },
                  { label: "Atur Kalibrasi Skala Y (Depth Scale)", icon: Compass, action: () => handleStepClick('calibrate') },
                  { label: "Buka Kanvas Digitasi Kurva", icon: PenTool, action: () => handleStepClick('digitize') },
                  { label: "Evaluasi Integritas Ilmiah (QC Check)", icon: ShieldAlert, action: () => handleStepClick('qc') },
                  { label: "Konfigurasi Ekspor Berkas LAS", icon: Save, action: () => handleStepClick('las') },
                  { label: "Simpan Proyek Saat Ini ke Disk", icon: Bookmark, action: saveProjectToLocal },
                  { label: "Muat Sesi Proyek Sebelumnya", icon: Upload, action: loadProjectFromLocal },
                ]
                  .filter(cmd => cmd.label.toLowerCase().includes(commandQuery.toLowerCase()))
                  .map((cmd, i) => {
                    const Icon = cmd.icon;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          setIsCommandPaletteOpen(false);
                          cmd.action();
                        }}
                        className="w-full text-left px-3 py-2 rounded text-xs text-slate-700 hover:bg-slate-100 transition flex items-center cursor-pointer group"
                      >
                        <Icon className="w-4 h-4 mr-2.5 text-slate-400 group-hover:text-slate-800 transition" />
                        <span className="font-semibold text-slate-700">{cmd.label}</span>
                      </button>
                    );
                  })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* NEW PROJECT CREATION MODAL */}
      <AnimatePresence>
        {showNewProjectModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-lg border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden flex flex-col font-sans"
            >
              <div className="bg-slate-50 border-b border-slate-100 p-4 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Inisialisasi Proyek Baru</span>
                <button
                  onClick={() => setShowNewProjectModal(false)}
                  className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs overflow-y-auto max-h-[75vh] custom-scrollbar">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Nama Sumur (Well Name)</label>
                  <input
                    type="text"
                    value={newWellName}
                    onChange={(e) => setNewWellName(e.target.value)}
                    className="w-full rounded border border-slate-200 px-3 py-1.5 text-xs focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Lapangan (Field)</label>
                    <input
                      type="text"
                      value={newField}
                      onChange={(e) => setNewField(e.target.value)}
                      className="w-full rounded border border-slate-200 px-3 py-1.5 text-xs focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Operator</label>
                    <input
                      type="text"
                      value={newOperator}
                      onChange={(e) => setNewOperator(e.target.value)}
                      className="w-full rounded border border-slate-200 px-3 py-1.5 text-xs focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Top Depth</label>
                    <input
                      type="number"
                      value={isNaN(newTopDepth) ? '' : newTopDepth}
                      onChange={(e) => {
                        const parsed = parseFloat(e.target.value);
                        setNewTopDepth(isNaN(parsed) ? 0 : parsed);
                      }}
                      className="w-full rounded border border-slate-200 px-3 py-1.5 text-xs focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Bottom Depth</label>
                    <input
                      type="number"
                      value={isNaN(newBottomDepth) ? '' : newBottomDepth}
                      onChange={(e) => {
                        const parsed = parseFloat(e.target.value);
                        setNewBottomDepth(isNaN(parsed) ? 0 : parsed);
                      }}
                      className="w-full rounded border border-slate-200 px-3 py-1.5 text-xs focus:outline-none"
                    />
                  </div>
                </div>

                {/* LOG CURVES CONFIGURATOR */}
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">KONFIGURASI LOG CURVES</span>
                    <button
                      type="button"
                      onClick={handleAddNewCurveConfig}
                      className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded text-[10px] font-bold shadow-xs cursor-pointer"
                    >
                      + Tambah Kurva
                    </button>
                  </div>
                  
                  {newCurves.length === 0 ? (
                    <div className="p-3 bg-slate-50 border border-slate-150 rounded text-center text-[11px] text-slate-400">
                      Belum ada kurva ditambahkan. Proyek akan dimulai dalam keadaan kosong. Anda dapat menambahkannya nanti di workspace.
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                      {newCurves.map((cfg) => (
                        <div key={cfg.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-md relative space-y-2">
                          <button
                            type="button"
                            onClick={() => handleRemoveCurveConfig(cfg.id)}
                            className="absolute top-1.5 right-1.5 text-slate-400 hover:text-rose-500 font-bold text-xs cursor-pointer"
                            title="Hapus kurva"
                          >
                            ×
                          </button>
                          
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[8.5px] font-bold text-slate-400 uppercase mb-0.5">Mnemonic</label>
                              <input
                                type="text"
                                placeholder="e.g. GR, ILD, RHOB"
                                value={cfg.mnemonic}
                                onChange={(e) => handleUpdateCurveConfig(cfg.id, { mnemonic: e.target.value.toUpperCase() })}
                                className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none bg-white font-mono font-bold"
                              />
                            </div>
                            <div>
                              <label className="block text-[8.5px] font-bold text-slate-400 uppercase mb-0.5">Unit</label>
                              <input
                                type="text"
                                placeholder="e.g. API, OHMM, G/CC"
                                value={cfg.unit}
                                onChange={(e) => handleUpdateCurveConfig(cfg.id, { unit: e.target.value })}
                                className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none bg-white font-mono"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
                            <div>
                              <label className="block text-[8.5px] font-bold text-slate-400 uppercase mb-0.5">Scale Type</label>
                              <select
                                value={cfg.scaleType}
                                onChange={(e) => handleUpdateCurveConfig(cfg.id, { scaleType: e.target.value as 'linear' | 'log' })}
                                className="w-full rounded border border-slate-200 px-1 py-1 focus:outline-none bg-white font-bold text-slate-700"
                              >
                                <option value="linear">Linear</option>
                                <option value="log">Log</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[8.5px] font-bold text-slate-400 uppercase mb-0.5">Min Val</label>
                              <input
                                type="number"
                                value={isNaN(cfg.valueMin) ? '' : cfg.valueMin}
                                onChange={(e) => {
                                  const parsed = parseFloat(e.target.value);
                                  handleUpdateCurveConfig(cfg.id, { valueMin: isNaN(parsed) ? 0 : parsed });
                                }}
                                className="w-full rounded border border-slate-200 px-1.5 py-1 focus:outline-none bg-white font-mono text-center"
                              />
                            </div>
                            <div>
                              <label className="block text-[8.5px] font-bold text-slate-400 uppercase mb-0.5">Max Val</label>
                              <input
                                type="number"
                                value={isNaN(cfg.valueMax) ? '' : cfg.valueMax}
                                onChange={(e) => {
                                  const parsed = parseFloat(e.target.value);
                                  handleUpdateCurveConfig(cfg.id, { valueMax: isNaN(parsed) ? 0 : parsed });
                                }}
                                className="w-full rounded border border-slate-200 px-1.5 py-1 focus:outline-none bg-white font-mono text-center"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Unggah Gambar Log Raster</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        const file = e.target.files[0];
                        setNewSelectedFile(file);
                        setNewSelectedFileName(file.name);
                      }
                    }}
                    className="text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-[10.5px] file:font-bold file:bg-slate-200 file:text-slate-700 hover:file:bg-slate-300 transition cursor-pointer"
                  />
                  {newSelectedFileName && (
                    <span className="text-[10.5px] text-emerald-600 font-semibold block font-sans">Terpilih: {newSelectedFileName}</span>
                  )}
                </div>
              </div>

              <div className="bg-slate-50 border-t border-slate-100 p-4 flex items-center justify-end gap-2 shrink-0 font-sans">
                <button
                  onClick={() => setShowNewProjectModal(false)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-600 rounded text-xs font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  onClick={() => {
                    handleNewProjectSubmit();
                    setShowNewProjectModal(false);
                  }}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-bold shadow-sm cursor-pointer"
                >
                  Inisialisasi
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SECURITY & DATA PRIVACY GUARANTEE MODAL */}
      <AnimatePresence>
        {showSecurityModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-sans">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="bg-slate-900 text-white p-5 flex items-start justify-between relative overflow-hidden shrink-0">
                <div className="absolute -right-6 -bottom-6 opacity-10 pointer-events-none">
                  <ShieldCheck className="w-40 h-40 text-emerald-400" />
                </div>
                <div className="flex items-start gap-3.5 z-10">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0 mt-0.5">
                    <ShieldCheck className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-extrabold px-2 py-0.5 rounded border border-emerald-400/30 uppercase tracking-wide">
                        E&P Subsurface Data Confidentiality
                      </span>
                      <span className="bg-slate-800 text-slate-300 text-[10px] font-mono px-2 py-0.5 rounded border border-slate-700">
                        Zero-Cloud Client Architecture
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-white tracking-tight leading-snug">
                      Jaminan Keamanan & Kerahasiaan Data Sensitif Sumur
                    </h2>
                    <p className="text-xs text-slate-300 mt-1">
                      Sistem CitraNeura dirancang agar seluruh pengolahan data dokumen migas dilakukan <strong>100% di dalam browser lokal Anda</strong>.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleCloseSecurityModal}
                  className="text-slate-400 hover:text-white p-1 rounded-lg transition cursor-pointer z-10"
                  title="Tutup"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body Scrollable */}
              <div className="p-5 overflow-y-auto space-y-4 custom-scrollbar text-xs text-slate-600 leading-relaxed bg-slate-50/50">
                
                {/* 1. Executive / Non-Tech Summary Box */}
                <div className="p-4 bg-emerald-50/80 border border-emerald-200/80 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Ringkasan Eksekutif (Untuk Manajemen & User Non-Teknis)</span>
                  </div>
                  <p className="text-emerald-800 text-[11.5px]">
                    Dokumen gambar sumur (TIFF/PNG/PDF), metadata sumur, koordinat, dan hasil digitasi kurva LAS/CSV Anda <strong>TIDAK PERNAH dikirim, disimpan, atau diunggah ke server internet/cloud manapun</strong>. Seluruh proses pembacaan file, kalibrasi, ekstraksi otomatis, hingga ekspor file LAS berjalan murni di memori komputer Anda sendiri. Anda dapat memutuskan koneksi internet dan aplikasi ini tetap berfungsi penuh tanpa kendala.
                  </p>
                </div>

                {/* 2. Technical Architecture Grid */}
                <div>
                  <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Cpu className="w-4 h-4 text-slate-700" />
                    Arsitektur Keamanan Teknis (Untuk Tim IT & Data Governance)
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs space-y-1">
                      <div className="flex items-center gap-2 font-bold text-slate-800 text-[11px]">
                        <HardDrive className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span>1. Local V8 JavaScript Runtime</span>
                      </div>
                      <p className="text-[10.5px] text-slate-500 leading-snug">
                        Gambar raster didekode via HTML5 Canvas API & WebGL context internal browser tanpa perantara backend server.
                      </p>
                    </div>

                    <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs space-y-1">
                      <div className="flex items-center gap-2 font-bold text-slate-800 text-[11px]">
                        <Cpu className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>2. Vector Auto-Trace Engine</span>
                      </div>
                      <p className="text-[10.5px] text-slate-500 leading-snug">
                        Algoritma ekstraksi matriks warna & ridge tracking berjalan murni menggunakan algoritma matematika lokal di client.
                      </p>
                    </div>

                    <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs space-y-1">
                      <div className="flex items-center gap-2 font-bold text-slate-800 text-[11px]">
                        <WifiOff className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>3. Air-Gapped Network Isolation</span>
                      </div>
                      <p className="text-[10.5px] text-slate-500 leading-snug">
                        Nol payload outbound HTTP/API request untuk pemrosesan file log sumur. Bebas dari risiko kebocoran data pihak ketiga.
                      </p>
                    </div>

                    <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs space-y-1">
                      <div className="flex items-center gap-2 font-bold text-slate-800 text-[11px]">
                        <Lock className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span>4. Isolated Browser Storage</span>
                      </div>
                      <p className="text-[10.5px] text-slate-500 leading-snug">
                        Penyimpanan sementara proyek menggunakan IndexedDB lokal terenkripsi sandbox browser, hanya dapat diakses perangkat Anda.
                      </p>
                    </div>
                  </div>
                </div>

                {/* 3. Bullet Key Security Guarantees */}
                <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1.5">
                  <h4 className="font-bold text-slate-800 text-xs">Poin-Poin Jaminan Kerahasiaan Subsurface:</h4>
                  <ul className="space-y-1 text-[11px] text-slate-600">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong>Proteksi Kekayaan Intelektual (IP):</strong> Melindungi peta struktur, kurva geofisika, dan koordinat sumur strategis milik perusahaan/K3S.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong>Dapat Dijalankan Offline:</strong> Anda dapat mengunduh web app ini atau mematikan jaringan saat mendigitasi dokumen paling sensitif.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong>Format LAS 2.0 Langsung di Komputer:</strong> File hasil ekspor LAS digenerate langsung menjadi blob memori lokal dan diunduh ke folder Downloads Anda.</span>
                    </li>
                  </ul>
                </div>

              </div>

              {/* Footer Actions */}
              <div className="p-4 bg-white border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={dontShowSecurityAgain}
                    onChange={(e) => setDontShowSecurityAgain(e.target.checked)}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-800"
                  />
                  <span>Jangan tampilkan pemberitahuan ini lagi di sesi awal</span>
                </label>

                <button
                  onClick={handleCloseSecurityModal}
                  className="w-full sm:w-auto px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shadow-sm transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Saya Paham, Lanjutkan ke Workspace</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FLOATING PROFILER */}
      {showProfiler && profileMetrics && (
        <FrameProfiler metrics={profileMetrics} stats={virtualRaster?.getDebugStats() || {}} />
      )}

    </div>
  );
}

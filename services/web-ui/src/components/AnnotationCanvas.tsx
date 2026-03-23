import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export type AnnotationTool = "freehand" | "arrow" | "rect" | "circle";

export interface AnnotationShape {
  tool: AnnotationTool;
  color: string;
  points: { x: number; y: number }[];
}

export interface FrameAnnotations {
  [frame: number]: AnnotationShape[];
}

export interface AnnotationCanvasHandle {
  getAnnotations(): FrameAnnotations;
  setAnnotations(annotations: FrameAnnotations): void;
  clearFrame(frame: number): void;
}

const PRESET_COLORS = [
  "#ef4444", // red
  "#f59e0b", // amber
  "#22c55e", // green
  "#22d3ee", // cyan
  "#a855f7", // purple
  "#ffffff", // white
];

const TOOL_LABELS: Record<AnnotationTool, string> = {
  freehand: "Draw",
  arrow: "Arrow",
  rect: "Rect",
  circle: "Circle",
};

interface Props {
  width: number;
  height: number;
  currentFrame: number;
  visible: boolean;
}

export const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, Props>(
  function AnnotationCanvas({ width, height, currentFrame, visible }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [tool, setTool] = useState<AnnotationTool>("freehand");
    const [color, setColor] = useState(PRESET_COLORS[0]);
    const [annotations, setAnnotations] = useState<FrameAnnotations>({});
    const [drawing, setDrawing] = useState(false);
    const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
    const undoStackRef = useRef<FrameAnnotations>({});

    useImperativeHandle(ref, () => ({
      getAnnotations: () => annotations,
      setAnnotations: (a) => setAnnotations(a),
      clearFrame: (frame) =>
        setAnnotations((prev) => {
          const next = { ...prev };
          delete next[frame];
          return next;
        }),
    }));

    // Render existing annotations for current frame
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);

      const frameShapes = annotations[currentFrame];
      if (!frameShapes) return;

      for (const shape of frameShapes) {
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        if (shape.tool === "freehand" && shape.points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(shape.points[0].x, shape.points[0].y);
          for (let i = 1; i < shape.points.length; i++) {
            ctx.lineTo(shape.points[i].x, shape.points[i].y);
          }
          ctx.stroke();
        } else if (shape.tool === "arrow" && shape.points.length === 2) {
          const [start, end] = shape.points;
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
          // Arrowhead
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const headLen = 12;
          ctx.beginPath();
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
        } else if (shape.tool === "rect" && shape.points.length === 2) {
          const [start, end] = shape.points;
          ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
        } else if (shape.tool === "circle" && shape.points.length === 2) {
          const [center, edge] = shape.points;
          const radius = Math.sqrt((edge.x - center.x) ** 2 + (edge.y - center.y) ** 2);
          ctx.beginPath();
          ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }, [annotations, currentFrame, width, height]);

    // Render in-progress shape on a second pass
    useEffect(() => {
      if (!drawing || currentPoints.length < 1) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Re-draw existing first
      ctx.clearRect(0, 0, width, height);
      const frameShapes = annotations[currentFrame];
      if (frameShapes) {
        for (const shape of frameShapes) {
          ctx.strokeStyle = shape.color;
          ctx.lineWidth = 2;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          if (shape.tool === "freehand" && shape.points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(shape.points[0].x, shape.points[0].y);
            for (let i = 1; i < shape.points.length; i++) ctx.lineTo(shape.points[i].x, shape.points[i].y);
            ctx.stroke();
          } else if (shape.tool === "rect" && shape.points.length === 2) {
            ctx.strokeRect(shape.points[0].x, shape.points[0].y, shape.points[1].x - shape.points[0].x, shape.points[1].y - shape.points[0].y);
          } else if (shape.tool === "circle" && shape.points.length === 2) {
            const r = Math.sqrt((shape.points[1].x - shape.points[0].x) ** 2 + (shape.points[1].y - shape.points[0].y) ** 2);
            ctx.beginPath();
            ctx.arc(shape.points[0].x, shape.points[0].y, r, 0, Math.PI * 2);
            ctx.stroke();
          } else if (shape.tool === "arrow" && shape.points.length === 2) {
            ctx.beginPath();
            ctx.moveTo(shape.points[0].x, shape.points[0].y);
            ctx.lineTo(shape.points[1].x, shape.points[1].y);
            ctx.stroke();
          }
        }
      }

      // Draw current in-progress shape
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (tool === "freehand" && currentPoints.length > 1) {
        ctx.beginPath();
        ctx.moveTo(currentPoints[0].x, currentPoints[0].y);
        for (let i = 1; i < currentPoints.length; i++) ctx.lineTo(currentPoints[i].x, currentPoints[i].y);
        ctx.stroke();
      }
    }, [drawing, currentPoints, tool, color, annotations, currentFrame, width, height]);

    const getCanvasCoords = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return {
          x: ((e.clientX - rect.left) / rect.width) * width,
          y: ((e.clientY - rect.top) / rect.height) * height,
        };
      },
      [width, height],
    );

    const handleMouseDown = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        const pt = getCanvasCoords(e);
        setDrawing(true);
        setCurrentPoints([pt]);
        // Save undo state
        undoStackRef.current = { ...annotations };
      },
      [getCanvasCoords, annotations],
    );

    const handleMouseMove = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!drawing) return;
        const pt = getCanvasCoords(e);
        if (tool === "freehand") {
          setCurrentPoints((prev) => [...prev, pt]);
        } else {
          // For shapes, keep start + current end
          setCurrentPoints((prev) => [prev[0], pt]);
        }
      },
      [drawing, tool, getCanvasCoords],
    );

    const handleMouseUp = useCallback(() => {
      if (!drawing) return;
      setDrawing(false);
      if (currentPoints.length < 1) return;

      const shape: AnnotationShape = {
        tool,
        color,
        points: [...currentPoints],
      };

      setAnnotations((prev) => ({
        ...prev,
        [currentFrame]: [...(prev[currentFrame] || []), shape],
      }));
      setCurrentPoints([]);
    }, [drawing, currentPoints, tool, color, currentFrame]);

    const handleUndo = useCallback(() => {
      setAnnotations((prev) => {
        const frameShapes = prev[currentFrame];
        if (!frameShapes || frameShapes.length === 0) return prev;
        const next = { ...prev, [currentFrame]: frameShapes.slice(0, -1) };
        if (next[currentFrame].length === 0) delete next[currentFrame];
        return next;
      });
    }, [currentFrame]);

    const handleClearFrame = useCallback(() => {
      setAnnotations((prev) => {
        const next = { ...prev };
        delete next[currentFrame];
        return next;
      });
    }, [currentFrame]);

    if (!visible) return null;

    const frameShapeCount = annotations[currentFrame]?.length ?? 0;

    return (
      <div className="absolute inset-0 z-10" data-testid="annotation-canvas">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="absolute inset-0 w-full h-full cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          aria-label="Annotation canvas"
        />
        {/* Toolbar */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-[var(--color-ah-bg)]/90 backdrop-blur-sm rounded-[var(--radius-ah-lg)] px-3 py-1.5 border border-[var(--color-ah-border-muted)]">
          {(Object.keys(TOOL_LABELS) as AnnotationTool[]).map((t) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              className={`px-2 py-1 text-xs rounded-[var(--radius-ah-sm)] transition-colors ${
                tool === t
                  ? "bg-[var(--color-ah-accent)] text-[var(--color-ah-bg)]"
                  : "text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
              }`}
              aria-label={`Tool: ${TOOL_LABELS[t]}`}
              aria-pressed={tool === t}
            >
              {TOOL_LABELS[t]}
            </button>
          ))}
          <span className="w-px h-4 bg-[var(--color-ah-border-muted)]" />
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full border-2 transition-transform ${
                color === c ? "border-white scale-110" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
            />
          ))}
          <span className="w-px h-4 bg-[var(--color-ah-border-muted)]" />
          <button
            onClick={handleUndo}
            disabled={frameShapeCount === 0}
            className="px-2 py-1 text-xs text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)] disabled:opacity-30"
            aria-label="Undo annotation"
          >
            Undo
          </button>
          <button
            onClick={handleClearFrame}
            disabled={frameShapeCount === 0}
            className="px-2 py-1 text-xs text-[var(--color-ah-danger)] hover:text-[var(--color-ah-danger)] disabled:opacity-30"
            aria-label="Clear frame annotations"
          >
            Clear
          </button>
        </div>
      </div>
    );
  },
);

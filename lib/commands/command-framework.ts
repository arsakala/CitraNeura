// CitraNeura Workspace Command Framework Foundation (v1.0)
// This module implements the Command Pattern to ensure all state changes
// are deterministic, auditable, atomic, and support robust command lifecycles.

import { ProjectState } from '../types';

export type CommandLifecycleStatus = 'initialized' | 'executing' | 'completed' | 'failed' | 'cancelled';

export interface CommandContext {
  getProjectState(): ProjectState;
  setProjectState(state: ProjectState, description: string): void;
  getViewport(): { zoomScale: number; panOffset: { x: number; y: number } };
  setViewport(zoomScale: number, panOffset: { x: number; y: number }): void;
  getTraceParameters(): {
    colorTolerance: number;
    sigma: number;
    maxAngle: number;
    gapTolerance: number;
    wColor: number;
    wRidge: number;
    wOrient: number;
    wMomentum: number;
  };
  setTraceParameters(params: Partial<{
    colorTolerance: number;
    sigma: number;
    maxAngle: number;
    gapTolerance: number;
    wColor: number;
    wRidge: number;
    wOrient: number;
    wMomentum: number;
  }>): void;
  getDirtyFlag(): boolean;
  setDirtyFlag(isDirty: boolean): void;
  log(message: string): void;
}

export interface Command {
  id: string;
  name: string;
  lifecycle: CommandLifecycleStatus;
  execute(context: CommandContext): Promise<void> | void;
  undo?(context: CommandContext): Promise<void> | void;
  error?: Error;
}

export interface AuditTrailEntry {
  timestamp: string;
  commandId: string;
  commandName: string;
  status: CommandLifecycleStatus;
  payload?: any;
  error?: string;
}

// 1. UPDATE VIEWPORT COMMAND
export class UpdateViewportCommand implements Command {
  id: string;
  name = 'Update Viewport';
  lifecycle: CommandLifecycleStatus = 'initialized';

  constructor(
    public zoomScale: number,
    public panOffset: { x: number; y: number }
  ) {
    this.id = `cmd_viewport_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  }

  execute(context: CommandContext): void {
    this.lifecycle = 'executing';
    try {
      context.setViewport(this.zoomScale, this.panOffset);
      this.lifecycle = 'completed';
      context.log(`Executed: ${this.name} to Zoom=${Math.round(this.zoomScale * 100)}%, Pan=(${Math.round(this.panOffset.x)}, ${Math.round(this.panOffset.y)})`);
    } catch (err: any) {
      this.lifecycle = 'failed';
      this.id = this.id; // reference check
      throw err;
    }
  }
}

// 2. UPDATE PROJECT STATE COMMAND
export class UpdateProjectStateCommand implements Command {
  id: string;
  name: string;
  lifecycle: CommandLifecycleStatus = 'initialized';
  previousState?: ProjectState;

  constructor(
    name: string,
    public nextState: ProjectState | ((prev: ProjectState) => ProjectState)
  ) {
    this.name = name;
    this.id = `cmd_project_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  }

  execute(context: CommandContext): void {
    this.lifecycle = 'executing';
    try {
      const currentState = context.getProjectState();
      this.previousState = currentState;
      const resolvedState = typeof this.nextState === 'function' ? this.nextState(currentState) : this.nextState;
      context.setProjectState(resolvedState, this.name);
      context.setDirtyFlag(true);
      this.lifecycle = 'completed';
      context.log(`Executed: ${this.name}`);
    } catch (err: any) {
      this.lifecycle = 'failed';
      throw err;
    }
  }

  undo(context: CommandContext): void {
    if (this.previousState) {
      context.setProjectState(this.previousState, `Undo: ${this.name}`);
    }
  }
}

// 3. UPDATE TRACE PARAMETERS COMMAND
export class UpdateTraceParamsCommand implements Command {
  id: string;
  name = 'Update Trace Parameters';
  lifecycle: CommandLifecycleStatus = 'initialized';
  previousParams?: Partial<{
    colorTolerance: number;
    sigma: number;
    maxAngle: number;
    gapTolerance: number;
    wColor: number;
    wRidge: number;
    wOrient: number;
    wMomentum: number;
  }>;

  constructor(
    public params: Partial<{
      colorTolerance: number;
      sigma: number;
      maxAngle: number;
      gapTolerance: number;
      wColor: number;
      wRidge: number;
      wOrient: number;
      wMomentum: number;
    }>
  ) {
    this.id = `cmd_trace_params_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  }

  execute(context: CommandContext): void {
    this.lifecycle = 'executing';
    try {
      const currentTraceParams = context.getTraceParameters();
      const keysToSave = Object.keys(this.params) as (keyof typeof currentTraceParams)[];
      const prev: any = {};
      keysToSave.forEach(k => {
        prev[k] = currentTraceParams[k];
      });
      this.previousParams = prev;

      context.setTraceParameters(this.params);
      this.lifecycle = 'completed';
      context.log(`Executed: ${this.name} (${Object.keys(this.params).join(', ')})`);
    } catch (err: any) {
      this.lifecycle = 'failed';
      throw err;
    }
  }

  undo(context: CommandContext): void {
    if (this.previousParams) {
      context.setTraceParameters(this.previousParams);
    }
  }
}

// 4. CLEAR ACTIVE CURVE POINTS COMMAND
export class ClearActiveCurvePointsCommand implements Command {
  id: string;
  name = 'Clear Active Curve Points';
  lifecycle: CommandLifecycleStatus = 'initialized';
  previousState?: ProjectState;

  constructor(public activeCurveId: string) {
    this.id = `cmd_clear_curve_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  }

  execute(context: CommandContext): void {
    this.lifecycle = 'executing';
    try {
      const currentProject = context.getProjectState();
      this.previousState = currentProject;
      const targetCurve = currentProject.curves.find(c => c.id === this.activeCurveId);
      if (!targetCurve) {
        throw new Error(`Curve ${this.activeCurveId} not found in current project state`);
      }

      const updatedCurves = currentProject.curves.map(c => {
        if (c.id === this.activeCurveId) {
          return { ...c, points: [] };
        }
        return c;
      });

      context.setProjectState({
        ...currentProject,
        curves: updatedCurves
      }, `Cleared all points on curve ${targetCurve.metadata.mnemonic}`);
      context.setDirtyFlag(true);
      this.lifecycle = 'completed';
      context.log(`Executed: Clear Active Curve Points for ${targetCurve.metadata.mnemonic}`);
    } catch (err: any) {
      this.lifecycle = 'failed';
      throw err;
    }
  }

  undo(context: CommandContext): void {
    if (this.previousState) {
      context.setProjectState(this.previousState, `Undo: ${this.name}`);
    }
  }
}

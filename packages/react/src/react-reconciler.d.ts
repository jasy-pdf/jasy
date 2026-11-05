// The part of react-reconciler 0.31 (React 19) this renderer uses. @types/react-reconciler still
// describes the React 18 API (`prepareUpdate`, no `updateContainerSync`), so it is not used.
declare module "react-reconciler" {
  export interface FiberRoot {
    readonly __fiberRoot: unique symbol;
  }
  export interface Reconciler {
    createContainer(
      containerInfo: unknown,
      tag: number,
      hydrationCallbacks: null,
      isStrictMode: boolean,
      concurrentUpdatesByDefaultOverride: null,
      identifierPrefix: string,
      onUncaughtError: (error: unknown) => void,
      onCaughtError: (error: unknown) => void,
      onRecoverableError: (error: unknown) => void,
      transitionCallbacks: null,
    ): FiberRoot;
    updateContainerSync(element: unknown, root: FiberRoot, parent: null, callback: null): void;
    flushSyncWork(): void;
    flushSyncFromReconciler(fn: () => void): void;
  }
  export default function createReconciler(hostConfig: object): Reconciler;
}
declare module "react-reconciler/constants.js" {
  export const LegacyRoot: number;
  export const DefaultEventPriority: number;
}

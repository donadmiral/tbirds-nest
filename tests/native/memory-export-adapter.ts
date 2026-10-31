/** Delegates every renderer input and export to the unchanged production service. */
import {exportNativeMemoryMovie as actualExport} from '../../src/services/memoryMovieExport';
import {observeExport} from './memory-capture-observer.cjs';
export async function exportNativeMemoryMovie(options:Parameters<typeof actualExport>[0]):ReturnType<typeof actualExport>{
 return observeExport(actualExport,options);
}
export type {NativeMemoryCapture,NativeMemoryProgress} from '../../src/services/memoryMovieExport';

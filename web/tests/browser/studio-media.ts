/** Identity media adapter: images are locally generated synthetic QA artwork. */
export function useUploadPreview<T>(value: T) { return { preview: value, error: null, retry() {} }; }
export async function hydrateUploadMedia<T>(rows: T[]) { return rows; }
export async function hydratePostMedia<T>(rows: T[]) { return rows; }

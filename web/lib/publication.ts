/** Checkpoints for the existing multi-request publisher. This does not make
 * publication atomic: it keeps a retry on the same post and never replays a
 * write whose outcome the server did not confirm. */
export class PublicationAttempt {
  private completed = new Map<string, unknown>();
  constructor(private beforeWrite?: () => Promise<void>) {}
  async check(): Promise<void> { await this.beforeWrite?.(); }
  uncertain = false;
  postId: string | null = null;

  get<T>(key: string): T | undefined { return this.completed.get(key) as T | undefined; }

  /** Only for operations carrying stable row IDs or a server idempotency key. */
  async writeIdempotent<T>(key: string, work: () => PromiseLike<{ data: T; error: unknown }>): Promise<T> {
    await this.check();
    if (this.completed.has(key)) return this.completed.get(key) as T;
    const result = await work();
    if (result.error) throw result.error;
    await this.check();
    this.completed.set(key, result.data);
    return result.data;
  }

  async write<T>(key: string, work: () => PromiseLike<{ data: T; error: unknown }>): Promise<T> {
    await this.check();
    if (this.completed.has(key)) return this.completed.get(key) as T;
    if (this.uncertain) throw new Error("The previous request could not be confirmed. Check your published content before trying again.");
    let result: { data: T; error: unknown };
    try {
      result = await work();
    } catch (error) {
      this.uncertain = true;
      throw error;
    }
    if (result.error) {
      // PostgreSQL errors confirm that the statement was rejected. Transport
      // errors (including a lost successful response) cannot safely be replayed.
      const code = (result.error as { code?: string }).code;
      if (!code || !/^(22|23|28|42|P0)[0-9A-Z]{3}$/.test(code)) this.uncertain = true;
      throw result.error;
    }
    this.completed.set(key, result.data);
    return result.data;
  }
}

export function publicationError(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "The request could not be completed.";
}

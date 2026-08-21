/** Errors that carry enough context for a tool result without leaking secrets. */

export class GarminHttpError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: string;

  constructor(status: number, path: string, body: string) {
    super(`Garmin returned ${status} for ${path}`);
    this.name = "GarminHttpError";
    this.status = status;
    this.path = path;
    // Truncated: upstream error pages can be entire HTML documents.
    this.body = body.slice(0, 2_000);
  }
}

export class GarminAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GarminAuthError";
  }
}

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/** A short, safe description of an unknown thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof GarminHttpError) {
    const detail = error.body.trim();
    return detail ? `${error.message}: ${detail}` : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

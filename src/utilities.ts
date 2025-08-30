/**
 * Standardized response utilities for Durable Objects
 */

export interface ErrorResponseOptions {
  status?: number;
  logError?: boolean;
  context?: string;
}

export interface SuccessResponseOptions {
  status?: number;
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(
  error: unknown, 
  options: ErrorResponseOptions = {}
): Response {
  const {
    status = 500,
    logError = true,
    context = 'Operation'
  } = options;

  const errorMessage = error instanceof Error ? error.message : String(error);
  
  if (logError) {
    console.error(`💥 ${context} error:`, error);
  }

  return new Response(JSON.stringify({
    success: false,
    error: errorMessage
  }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Create a standardized success response
 */
export function createSuccessResponse(
  data: any, 
  options: SuccessResponseOptions = {}
): Response {
  const { status = 200 } = options;

  return new Response(JSON.stringify({
    success: true,
    ...data
  }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Create a simple JSON response
 */
export function createJsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Create a standardized not found response
 */
export function createNotFoundResponse(message: string = 'Not found'): Response {
  return new Response(JSON.stringify({
    error: message
  }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}
'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="max-w-md rounded-lg bg-white p-8 shadow-lg text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Something went wrong
          </h2>
          <p className="text-gray-600 mb-6 text-sm">
            An unexpected error occurred. Please try again.
          </p>
          {error.digest && (
            <p className="text-xs text-gray-400 mb-4 font-mono">
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

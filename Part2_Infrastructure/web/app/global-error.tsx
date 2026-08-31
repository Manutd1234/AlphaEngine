"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main aria-labelledby="global-error-heading">
          <h1 id="global-error-heading">AlphaEngine could not start</h1>
          <p>The application shell failed before the workspace became available.</p>
          <button type="button" onClick={reset}>Retry application</button>
        </main>
      </body>
    </html>
  );
}

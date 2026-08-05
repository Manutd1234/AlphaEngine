"use client";

/**
 * Client-side download — a Blob and an anchor, no server round trip.
 *
 * Lifted out of the experiment history when the order blotter needed the same
 * three lines; every export surface in the app goes through here.
 */
export function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

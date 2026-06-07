// Image module declarations for Next.js static imports.
// next-env.d.ts is gitignored (it's generated), so we declare these here
// to fix the pre-existing TS2307 error on @/public/*.png imports.
declare module '*.png' {
  const content: import('next/dist/shared/lib/image-external').StaticImageData;
  export default content;
}
declare module '*.jpg' {
  const content: import('next/dist/shared/lib/image-external').StaticImageData;
  export default content;
}
declare module '*.jpeg' {
  const content: import('next/dist/shared/lib/image-external').StaticImageData;
  export default content;
}
declare module '*.webp' {
  const content: import('next/dist/shared/lib/image-external').StaticImageData;
  export default content;
}
declare module '*.svg' {
  const content: string;
  export default content;
}

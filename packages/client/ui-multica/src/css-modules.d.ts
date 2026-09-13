/** Bundler-owned CSS Module class names. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

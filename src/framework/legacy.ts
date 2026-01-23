// src/framework/legacy.ts - Backwards Compatibility Shims
//
// Legacy items kept for URI resolution fallback and type aliases.

// ─────────────────────────────────────────────────────────────────────────────
// Backwards Compatibility Type Alias
// ─────────────────────────────────────────────────────────────────────────────

// Res<P> is now an alias for Specifier<P> - the unified navigable reference type
type Res<P> = Specifier<P>;

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Scalar Alias
// ─────────────────────────────────────────────────────────────────────────────

// Base scalar for fallback in URI resolution (alias for passthrough)
const baseScalar = passthrough;

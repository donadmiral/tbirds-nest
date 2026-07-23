/**
 * Layout constants shared across tab screens.
 * The bottom tab bar floats: 64pt tall, sitting insets.bottom + 10 from the edge.
 * Scrollable content must clear insets.bottom + TAB_BAR_CLEARANCE or the last
 * item hides underneath it.
 */
export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_GAP = 10;
export const TAB_BAR_CLEARANCE = TAB_BAR_HEIGHT + TAB_BAR_GAP + 12; // 86
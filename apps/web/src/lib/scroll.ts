/**
 * Scroll an in-page target inside the app's dedicated page scroller.
 *
 * Native `scrollIntoView()` walks all scrollable ancestors. In this app the
 * document/body is intentionally locked while `[data-page-scroll]` owns page
 * scrolling; letting the browser pick ancestors can move the viewport/shell and
 * make the content column appear to jump out of place.
 */
export function scrollIntoPageView(target: HTMLElement, behavior: ScrollBehavior = "smooth") {
  const pageScroller = document.querySelector<HTMLElement>("[data-page-scroll]");

  if (!pageScroller) {
    target.scrollIntoView({ behavior, block: "start" });
    return;
  }

  const scrollerRect = pageScroller.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const scrollMarginTop = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;

  pageScroller.scrollTo({
    behavior,
    top: pageScroller.scrollTop + targetRect.top - scrollerRect.top - scrollMarginTop,
  });
}

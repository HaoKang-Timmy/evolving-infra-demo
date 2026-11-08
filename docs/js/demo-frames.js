/* The demos of the idea sections are pages in docs/demos/, embedded in frames. Each page reports its height,
   and the frame takes that height, so the page never scrolls inside the frame. */
(() => {
  'use strict';

  const frames = () => Array.from(document.querySelectorAll('.demo-frame iframe'));

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.type !== 'demo-height' || !(data.height > 0)) return;
    const frame = frames().find((f) => f.contentWindow === event.source);
    if (frame) frame.style.height = `${Math.ceil(data.height)}px`;
  });

  // A page can report its height before this script runs; read it directly once the frame has loaded.
  frames().forEach((frame) => {
    const read = () => {
      try {
        const body = frame.contentDocument && frame.contentDocument.body;
        const height = body ? body.getBoundingClientRect().height : 0;
        if (height > 0) frame.style.height = `${Math.ceil(height)}px`;
      } catch (e) { /* the message above still sizes the frame */ }
    };
    frame.addEventListener('load', read);
    read();
  });
})();

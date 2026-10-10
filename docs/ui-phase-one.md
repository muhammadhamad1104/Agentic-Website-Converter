# UI Phase One

Scope: the entire public homepage and login, registration, forgotten-password,
and reset-password screens. Conversion logic, billing policy, project statistics,
and preview lifecycle are unchanged. Profile/admin and converter steps are the
next two design phases.

## Direction

- Existing forest, charcoal, and neutral palette retained.
- Space Grotesk and Manrope paired with a restrained editorial serif accent.
- One pinned three-dimensional sequence, with source, exploded structure, and
  connected website/admin compositions driven by scroll position.
- Chapter navigation remains native anchor navigation. Inactive copy cannot
  receive focus. Reduced-motion preferences disable interpolation and idle motion.
- The homepage renders on demand; motion continues only while settling.
  Offscreen and background-tab canvases stop rendering.
- Auth forms retain their existing validation and API behavior.

## Artwork

The architectural portfolio in the scene is an illustrative demonstration, not
a stored conversion or a fabricated user metric.

Tool: built-in image generation. Generated source and compressed local asset:

- `apps/frontend/public/media/pavilion-original.png`
- `apps/frontend/public/media/pavilion.webp`

Final generation prompt:

> Use case: photorealistic-natural. Asset type: architectural portfolio photograph
> embedded as media in a 3D demonstration website for a static-to-dynamic website
> converter. Create one high-resolution wide landscape editorial architectural
> photograph of a striking modern low-rise pavilion with pale concrete cantilevered
> slabs, floor-to-ceiling glass, and precisely detailed vertical brushed metal fins,
> amid lush muted green trees. Clear daylight, realistic materials, elegantly
> composed straight architectural lines, building clearly visible and inspectable
> across the frame. Sophisticated architectural-magazine photography, restrained
> natural greens and neutral grey/off-white. No people, no text, no logo, no
> watermark, no UI, no border, no dark fog, no gradients. It is an architectural
> project photograph, not a background texture or web mockup.

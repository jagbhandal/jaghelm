### Changed
- The web app now builds with Tailwind CSS v4, and shadcn/ui and Lucide icons are
  set up for the redesign's shared component library, which the Android app will
  use too. Every screen looks as it did: the new styles reach only components built
  on the new stack, and none are on screen yet. The stylesheet the browser
  downloads grows by about 3 KB compressed, and nothing is loaded from a new
  third-party address.

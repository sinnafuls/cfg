// See https://kit.svelte.dev/docs/types#app
//
// CFG is a stateless verification flow - there is no logged-in session
// cookie like perceptor's dashboard. The OAuth round-trip is one-shot
// (token in signed state, consumed in the callback), so App.Locals stays
// empty. Per-request client IP is read on demand via getClientAddress().

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};

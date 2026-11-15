import { routeHandler } from '../lib/http.js';

const handler = routeHandler('order');

// Every method is routed to the same handler so that it, not the platform,
// answers wrong methods with a consistent 405 body and security headers.
export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as HEAD,
  handler as OPTIONS,
};

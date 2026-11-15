import { webCallHandler } from '../lib/http.js';

const handler = webCallHandler();

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as HEAD,
  handler as OPTIONS,
};

import { stocksPages } from '../../edge/stocks-pages.mjs';
export const onRequest = ({ request, env }) => stocksPages(request, env);

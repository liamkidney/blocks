// Variant defaults may be supplied by the hosting page; URL options take precedence.
const blocksParams=new URLSearchParams(location.search);
window.BLOCKS_CONFIG={
  ...window.BLOCKS_CONFIG,
  ...(blocksParams.get("pieces")?.toUpperCase()==="IO"?{allowedPieces:["I","O"]}:{})
  ...(blocksParams.has("ghost")?{ghostPiece:blocksParams.get("ghost")==="true"}:{})
};

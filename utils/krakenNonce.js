let lastNonce = 0;

const nextKrakenNonce = () => {
  // Use microsecond-scale nonce to reduce collisions within the same millisecond.
  const now = Date.now() * 1000;
  lastNonce = now > lastNonce ? now : lastNonce + 1;
  return lastNonce;
};

module.exports = {
  nextKrakenNonce,
};

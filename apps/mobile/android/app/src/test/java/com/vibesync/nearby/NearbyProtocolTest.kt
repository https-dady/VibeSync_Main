package com.vibesync.nearby

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NearbyProtocolTest {
  @Test fun recoveryProofMatchesRfc4231Sha256Vector() {
    assertEquals("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
      NearbyProtocol.recoveryProof("Jefe", "what do ya want for nothing?"))
  }
  @Test fun closedAndOpenRanges() {
    assertEquals(NearbyProtocol.ByteRange(10, 19), NearbyProtocol.parseRange("bytes=10-19", 100))
    assertEquals(NearbyProtocol.ByteRange(10, 99), NearbyProtocol.parseRange("bytes=10-", 100))
    assertEquals(NearbyProtocol.ByteRange(10, 99), NearbyProtocol.parseRange("bytes=10-999", 100))
  }
  @Test fun suffixRanges() {
    assertEquals(NearbyProtocol.ByteRange(90, 99), NearbyProtocol.parseRange("bytes=-10", 100))
    assertEquals(NearbyProtocol.ByteRange(0, 99), NearbyProtocol.parseRange("bytes=-999", 100))
  }
  @Test fun rejectsMalformedUnsatisfiableAndOverflowRanges() {
    listOf("bytes=-0", "bytes=-", "bytes=100-", "bytes=20-10", "bytes=1-2,4-5",
      "bytes=999999999999999999999999-", "bytes=1-999999999999999999999999", "bytes=abc-9")
      .forEach { assertNull(it, NearbyProtocol.parseRange(it, 100)) }
    assertNull(NearbyProtocol.parseRange("bytes=0-", 0))
  }
}

package com.vibesync.nearby

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Single-range RFC 9110 parser shared by the local HTTP endpoint and JVM tests. */
internal object NearbyProtocol {
  fun recoveryProof(key: String, challenge: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key.toByteArray(Charsets.UTF_8), "HmacSHA256"))
    return mac.doFinal(challenge.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 0xff) }
  }

  data class ByteRange(val start: Long, val end: Long)

  fun parseRange(header: String, size: Long): ByteRange? {
    if (size <= 0) return null
    val match = Regex("^bytes=(\\d*)-(\\d*)$").matchEntire(header.trim()) ?: return null
    val first = match.groupValues[1]
    val last = match.groupValues[2]
    if (first.isEmpty()) {
      val suffix = last.toLongOrNull() ?: return null
      if (suffix <= 0) return null
      return ByteRange((size - suffix).coerceAtLeast(0), size - 1)
    }
    val start = first.toLongOrNull() ?: return null
    val end = if (last.isEmpty()) size - 1 else last.toLongOrNull() ?: return null
    if (start < 0 || start >= size || end < start) return null
    return ByteRange(start, end.coerceAtMost(size - 1))
  }
}

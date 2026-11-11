import Foundation

/// How old a sign-in token is, read off the token itself: a JWT's middle part is plain base64 JSON,
/// and the phone only needs the day it was made, not to check it.
enum TokenAge {
    /// A token this old is swapped for a fresh one, so a session lasts as long as it is used — the
    /// server's tokens run out thirty days after they are made, and the web does the same.
    static let refreshAfter: TimeInterval = 24 * 60 * 60

    static func issuedAt(_ token: String) -> Date? {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var base64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64),
              let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let issued = claims["iat"] as? Double else { return nil }
        return Date(timeIntervalSince1970: issued)
    }

    /// A token that does not say when it was made is renewed too: better one call than a lapse.
    static func needsRefresh(_ token: String, now: Date = Date()) -> Bool {
        guard let issued = issuedAt(token) else { return true }
        return now.timeIntervalSince(issued) >= refreshAfter
    }
}

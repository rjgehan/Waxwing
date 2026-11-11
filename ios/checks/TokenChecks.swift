import Foundation

/// When a sign-in token is renewed (TokenAge.swift): once it is a day old, so a phone that is used
/// never meets the server's thirty-day limit.
func tokenChecks() {
    // A token as the server makes them: header.payload.signature, the payload base64url without padding.
    func token(issued: Double?, extra: String = "") -> String {
        var payload = "{\"sub\":\"u\",\"username\":\"joe?>\""
        if let issued { payload += ",\"iat\":\(Int(issued))" }
        payload += extra + "}"
        let body = Data(payload.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "eyJhbGciOiJIUzI1NiJ9.\(body).sig"
    }

    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let hour = 3600.0, day = 86400.0

    check(TokenAge.issuedAt(token(issued: now.timeIntervalSince1970 - 5 * day)) == now.addingTimeInterval(-5 * day),
          "the day a token was made is read from it, whatever padding and symbols its payload carries")
    check(!TokenAge.needsRefresh(token(issued: now.timeIntervalSince1970 - 2 * hour), now: now),
          "a token made two hours ago is left alone")
    check(TokenAge.needsRefresh(token(issued: now.timeIntervalSince1970 - day), now: now),
          "a day old is time to renew")
    check(TokenAge.needsRefresh(token(issued: now.timeIntervalSince1970 - 25 * day), now: now),
          "so is nearly a month: the sign-in the parents' phones were left with")

    // Anything unreadable is renewed, as the web does, rather than trusted.
    check(TokenAge.issuedAt("not a token") == nil && TokenAge.needsRefresh("not a token", now: now), "not a token at all")
    check(TokenAge.issuedAt("a.b.c") == nil && TokenAge.needsRefresh("a.b.c", now: now), "a payload that is not JSON")
    check(TokenAge.issuedAt(token(issued: nil)) == nil && TokenAge.needsRefresh(token(issued: nil), now: now),
          "a token that does not say when it was made")
}

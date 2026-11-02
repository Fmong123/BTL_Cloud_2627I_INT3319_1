"""Kiểm thử lõi xác minh JWT (không cần FastAPI hay mạng)."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
import jwt
from jwt.exceptions import PyJWKClientConnectionError

from app.services.cognito_auth import AuthError, CognitoVerifier, role_from_groups

POOL = "ap-southeast-2_ZgGsJVM2u"
CLIENT = "75a0p1bv9bihkmgrkrrbb6nk7p"
ISSUER = f"https://cognito-idp.ap-southeast-2.amazonaws.com/{POOL}"


def make_key():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return pem, private.public_key()


PRIVATE_PEM, PUBLIC_KEY = make_key()
OTHER_PEM, _ = make_key()


class FakeJwks:
    def __init__(self, error=None):
        self.error = error

    def get_signing_key_from_jwt(self, token):
        if self.error:
            raise self.error
        return SimpleNamespace(key=PUBLIC_KEY)


def token(*, groups=("user",), pem=PRIVATE_PEM, **overrides):
    now = datetime.now(timezone.utc)
    claims = {
        "sub": str(uuid4()), "iss": ISSUER, "client_id": CLIENT, "token_use": "access",
        "username": "someone", "iat": now, "exp": now + timedelta(hours=1),
    }
    if groups is not None:
        claims["cognito:groups"] = list(groups)
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, pem, algorithm="RS256", headers={"kid": "k1"})


class VerifierTests(unittest.TestCase):
    def setUp(self):
        self.verifier = CognitoVerifier(user_pool_id=POOL, app_client_id=CLIENT, jwks_client=FakeJwks())

    def denied(self, tok, status):
        with self.assertRaises(AuthError) as ctx:
            self.verifier.verify(tok)
        self.assertEqual(ctx.exception.status_code, status)

    def test_user_token(self):
        sub = str(uuid4())
        user = self.verifier.verify(token(sub=sub, groups=["user"]))
        self.assertEqual((user.owner_id, user.role), (sub, "user"))

    def test_admin_token_and_admin_wins_over_user(self):
        self.assertEqual(self.verifier.verify(token(groups=["admin"])).role, "admin")
        self.assertEqual(self.verifier.verify(token(groups=["user", "admin"])).role, "admin")

    def test_expired(self):
        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        self.denied(token(exp=past), 401)

    def test_wrong_issuer(self):
        self.denied(token(iss="https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_Other"), 401)

    def test_wrong_client_id(self):
        self.denied(token(client_id="someoneelse"), 401)

    def test_id_token_rejected(self):
        self.denied(token(token_use="id"), 401)

    def test_no_group_is_forbidden(self):
        self.denied(token(groups=None), 403)
        self.denied(token(groups=["guest"]), 403)

    def test_signed_with_other_key(self):
        self.denied(token(pem=OTHER_PEM), 401)

    def test_alg_none_and_hs256_rejected(self):
        claims = {"sub": str(uuid4()), "iss": ISSUER, "client_id": CLIENT, "token_use": "access",
                  "cognito:groups": ["admin"], "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
        self.denied(jwt.encode(claims, key=None, algorithm="none"), 401)
        self.denied(jwt.encode(claims, "secret" * 8, algorithm="HS256"), 401)

    def test_sub_must_be_uuid(self):
        self.denied(token(sub="../../etc"), 401)

    def test_missing_exp(self):
        claims = {"sub": str(uuid4()), "iss": ISSUER, "client_id": CLIENT, "token_use": "access",
                  "cognito:groups": ["admin"]}
        self.denied(jwt.encode(claims, PRIVATE_PEM, algorithm="RS256", headers={"kid": "k1"}), 401)

    def test_garbage(self):
        self.denied("not-a-jwt", 401)

    def test_jwks_unreachable_is_503(self):
        verifier = CognitoVerifier(
            user_pool_id=POOL, app_client_id=CLIENT,
            jwks_client=FakeJwks(error=PyJWKClientConnectionError("boom")),
        )
        with self.assertRaises(AuthError) as ctx:
            verifier.verify(token())
        self.assertEqual(ctx.exception.status_code, 503)

    def test_bad_config_rejected(self):
        with self.assertRaises(ValueError):
            CognitoVerifier(user_pool_id="bad", app_client_id=CLIENT)
        with self.assertRaises(ValueError):
            CognitoVerifier(user_pool_id=POOL, app_client_id=" ")

    def test_role_from_groups(self):
        self.assertIsNone(role_from_groups([]))
        self.assertIsNone(role_from_groups([None, 3]))
        self.assertEqual(role_from_groups(["user"]), "user")


if __name__ == "__main__":
    unittest.main()

# Disposable TLS fixtures

These certificates and the server private key are public test fixtures, never
deployment credentials. The CA private key is not retained. The normal certificate
has a localhost DNS SAN; the wrong-name and expired certificates use the same test
server key and CA. The normal CA/server certificates expire in 2046. Regenerate
these fixtures before expiry. They are mounted only in the isolated TLS test service.

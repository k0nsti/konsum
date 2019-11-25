[![Build Status](https://secure.travis-ci.org/k0nsti/konsum.png)](http://travis-ci.org/k0nsti/konsum)
[![codecov.io](http://codecov.io/github/k0nsti/konsum/coverage.svg?branch=master)](http://codecov.io/github/k0nsti/konsum?branch=master)
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
[![Coverage Status](https://coveralls.io/repos/k0nsti/konsum/badge.svg)](https://coveralls.io/r/k0nsti/konsum)
[![downloads](http://img.shields.io/npm/dm/konsum.svg?style=flat-square)](https://npmjs.org/package/konsum)
[![GitHub Issues](https://img.shields.io/github/issues/k0nsti/konsum.svg?style=flat-square)](https://github.com/k0nsti/konsum/issues)
[![Greenkeeper](https://badges.greenkeeper.io/k0nsti/konsum.svg)](https://greenkeeper.io/)
[![Known Vulnerabilities](https://snyk.io/test/github/k0nsti/konsum/badge.svg)](https://snyk.io/test/github/k0nsti/konsum)
[![License](https://img.shields.io/badge/License-BSD%203--Clause-blue.svg)](https://opensource.org/licenses/BSD-3-Clause)
[![minified size](https://badgen.net/bundlephobia/min/konsum)](https://bundlephobia.com/result?p=konsum)
[![npm](https://img.shields.io/npm/v/konsum.svg)](https://www.npmjs.com/package/konsum)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/k0nsti/konsum)
[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

# konsum

# run

```shell
konsum --config=<<some dir>> start
```

```shell
konsum --config=<<some dir>> list [category]
```

```shell
konsum --config=<<some dir>> insert category value [time]
```

```shell
konsum --config=<<some dir>> backup [file]
```

```shell
konsum --config=<<some dir>> restore [file]
```

# install

```shell
npm -g install konsum
```

# how to configure

# create self signed cert

```shell
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
```

# JWT

# token setup

```shell
openssl genrsa -out demo.rsa 1024
openssl rsa -in demo.rsa -pubout > demo.rsa.pub
```

test with:

```shell
curl -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"start123"}' \
     -X POST http://localhost:12345/authenticate
```

and exec a request

```shell
TOKEN=...
CATEGORY=...
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:12345/category/$CATEGORY/values
```

```shell
TOKEN=...
CATEGORY=...
curl -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"value":"1234.5","time":"1995-12-17T03:24:00"}' \
     http://localhost:12345/category/$CATEGORY/insert
```

Or directly calling the executable

```shell
konsum insert ev 90091.3 '2019-06-22T13:44:17'
```

# API

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

### Table of Contents

-   [addRoute](#addroute)

## addRoute

login to request api token

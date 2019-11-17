const Express = require('express')
const Jwt = require('jsonwebtoken')
const Kopter = require('../../Kopter')
const { Container } = require('typedi')
const { USER_MODEL } = require('../../utils/constants')
const jwtAuthMiddleware = require('../../middleware/jwt-auth')
const generateFakeUser = require('../test-utils/generate-fake-user')
const clearRegisteredModels = require('../test-utils/clear-registered-models')

process.env.JWT_SECRET = 'shhh'
process.env.MONGODB_URL = 'mongodb://localhost:27017/kopter'
process.env.STRIPE_API_KEY = 'sk_test_BbvXhW3mzZBf52YzR1ihwlqU'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_RMA5R0RsvmJfSRQjbsv0rwiRJKhXJ7Ne'

beforeEach(clearRegisteredModels)

test('The middleware allows authenticated users to go through just fine', async () => {
    await new Kopter(Express()).init()

    const user = await Container.get(USER_MODEL).create(generateFakeUser())
    const token = Jwt.sign({ _id: user._id }, process.env.JWT_SECRET)

    const request = {
        headers: {
            authorization: `Bearer ${token}`
        }
    }

    const response = {}
    const next = jest.fn()

    await jwtAuthMiddleware(request, response, next)

    expect(next).toHaveBeenCalled()
})

test('The middleware returns an error if no authorization header is provided', async () => {
    await new Kopter().init()
    const response = {
        unauthorized: jest.fn()
    }
    const request = {
        headers: {}
    }
    const next = jest.fn()

    await jwtAuthMiddleware(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(response.unauthorized).toHaveBeenCalledWith(
        'Invalid authentication token.'
    )
})

test('The middleware returns an error if a valid jwt is malformed', async () => {
    await new Kopter().init()

    const user = await Container.get(USER_MODEL).create(generateFakeUser())
    const token = Jwt.sign({ id: user._id }, process.env.JWT_SECRET)

    const response = {
        unauthorized: jest.fn()
    }
    const request = {
        headers: {
            authorization: `Bearer ${token}`
        }
    }
    const next = jest.fn()

    await jwtAuthMiddleware(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(response.unauthorized).toHaveBeenCalledWith(
        'Invalid authentication token.'
    )
})

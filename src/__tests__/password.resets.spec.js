const Faker = require('faker')
const Bcrypt = require('bcryptjs')
require('./test-utils/setup-env')()
const Kopter = require('../Kopter')
const Request = require('supertest')
const Mongoose = require('mongoose')
const { Container } = require('typedi')
const clearRegisteredModels = require('./test-utils/clear-registered-models')
const { USER_MODEL, PASSWORD_RESETS_MODEL } = require('../utils/constants')

const kopterKonfig = require('../bin/templates/server/kopter.config')

const defaultKopterConfig = {
    ...kopterKonfig,
    pino: false,
    mail: {
        connection: 'memory',
        views: '/src/mails',
        viewEngine: 'handlebars',
        memory: {
            driver: 'memory'
        }
    },
    queue: {
        workers: [
            {
                name: 'mails.queue',
                id: '',
                handler() {}
            }
        ]
    },
    PasswordResetService: null
}

beforeEach(clearRegisteredModels)

afterAll(async () => {
    await Container.get(USER_MODEL).deleteMany({})
    await Mongoose.connection.close()
})

const generateFakeUser = () => ({
    email: Faker.internet.email(),
    emailConfirmCode: Faker.random.word(),
    password: Bcrypt.hashSync('password')
})

test('/auth/forgot-password can send forget password email', async () => {
    const { app } = await new Kopter(defaultKopterConfig).init()
    await Container.get(USER_MODEL).deleteMany({})

    const user = generateFakeUser()
    await Container.get(USER_MODEL).create(user)

    const response = await Request(app)
        .post('/auth/forgot-password')
        .send({
            email: user.email
        })

    expect(response.body.code).toBe('ok')
    expect(response.body.data).toMatchSnapshot()
})

test('/auth/forgot-password does not send forget password email', async () => {
    const { app } = await new Kopter(defaultKopterConfig).init()

    const response = await Request(app)
        .post('/auth/forgot-password')
        .send({
            email: 'email_does_not_exist@gmail.com'
        })

    expect(response.body.code).toBe('badRequest')
    expect(response.body.data).toMatchSnapshot()
})

test('/auth/reset-password can reset password', async () => {
    const { app } = await new Kopter(defaultKopterConfig).init()

    await Container.get(USER_MODEL).deleteMany({})

    const user = generateFakeUser()
    const newUser = await Container.get(USER_MODEL).create(user)

    await Request(app)
        .post('/auth/forgot-password')
        .send({
            email: user.email
        })

    const resetToken = await Container.get(PASSWORD_RESETS_MODEL).findOne({
        user: newUser._id
    })

    const response = await Request(app)
        .put(`/auth/reset-password/${resetToken.token}`)
        .send({
            password: 'password'
        })

    expect(response.body.code).toBe('ok')
    expect(response.body.data).toMatchSnapshot()
})

test('/auth/reset-password does not reset password for wrong token', async () => {
    const { app } = await new Kopter(defaultKopterConfig).init()

    const user = generateFakeUser()
    const newUser = await Container.get(USER_MODEL).create(user)

    await Request(app)
        .post('/auth/forgot-password')
        .send({
            email: user.email
        })

    const response = await Request(app)
        .put(`/auth/reset-password/wrong_token`)
        .send({
            password: 'password'
        })

    expect(response.body.code).toBe('badRequest')
    expect(response.body.data).toMatchSnapshot()
})

test('/auth/register validates email', async () => {
    const { app } = await new Kopter(defaultKopterConfig).init()

    const response = await Request(app)
        .post('/auth/forgot-password')
        .send({})

    expect(response.body.code).toBe('badRequest')
    expect(response.body).toMatchSnapshot()
})

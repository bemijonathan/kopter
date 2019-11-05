const Fs = require('fs')
const Path = require('path')
const Bull = require('bull')
const Cors = require('cors')
const Dotenv = require('dotenv')
const Express = require('express')
const Omit = require('object.omit')
const Mongoose = require('mongoose')
const DeepMerge = require('deepmerge')
const { Container } = require('typedi')
const BodyParser = require('body-parser')
const { getValue } = require('indicative-utils')
const PinoLogger = require('express-pino-logger')
const { extend } = require('indicative/validator')
const { EventEmitter2 } = require('eventemitter2')
const asyncRequest = require('./utils/async-request')

const {
    EVENT_DISPATCHER,
    X_POWERED_BY,
    USER_MODEL,
    USER_SERVICE,
    MAIL_SERVICE,
    USER_REGISTERED,
    LOGIN_CONTROLLER,
    REGISTER_CONTROLLER
} = require('./utils/constants')
const UserSchema = require('./models/user.model')
const StatusCodes = require('./utils/status-codes')
const UserService = require('./services/user.service')
const MailService = require('./services/mail.service')
const LoginController = require('./controllers/login.controller')
const RegisterController = require('./controllers/register.controller')

class Kopter {
    constructor(config = {}) {
        this.app = Express()

        this.config = {
            bodyParser: {},
            pino: {},
            dotenv: {},
            cors: {},
            UserSchema,
            UserService,
            MailService,
            disableXPoweredByHeader: true,
            mongoose: {
                useCreateIndex: true,
                useNewUrlParser: true,
                useUnifiedTopology: true
            },
            mail: {
                views: 'src/mails',
                connection: 'ethereal',
                viewEngine: 'handlebars'
            },
            disableRegistrationEventListeners: false,
            queue: {
                workers: [
                    {
                        name: 'mails.queue',
                        options: {},
                        handler() {
                            console.log('############# MAGIC HAPPENING HERE')
                        }
                    }
                ]
            }
        }

        const plainConfig = Omit(config, [
            'UserSchema',
            'UserService',
            'MailService'
        ])
        const plainDefaultConfig = Omit(this.config, [
            'UserSchema',
            'UserService',
            'MailService'
        ])

        /**
         * Merge the config with the default one.
         */
        this.config = {
            UserSchema: config.UserSchema || this.config.UserSchema,
            UserService: config.UserService || this.config.UserService,
            MailService: config.MailService || this.config.MailService,
            ...DeepMerge(plainDefaultConfig, plainConfig)
        }
    }

    /**
     * Registers the body-parser middleware
     */
    registerBodyParser() {
        this.app.use(BodyParser.json(this.config.bodyParser || {}))
    }

    /**
     * Disable x-powered-by header added by default in express
     */
    disableXPoweredByHeader() {
        this.app.disable(X_POWERED_BY)
    }

    registerQueueWorkers() {
        this.config.queue.workers.forEach(worker => {
            Container.set(worker.name, new Bull(worker.name))
        })
    }

    /**
     * Registers the pino logger middleware
     */
    registerPinoLogger() {
        this.app.use(PinoLogger(this.config.pino || {}))
    }

    registerEventEmitter() {
        Container.set(EVENT_DISPATCHER, new EventEmitter2({}))
    }

    /**
     * Register the dotenv package
     */
    registerDotEnv() {
        Dotenv.config(this.config.dotenv || {})
    }

    /**
     * Register the cors package
     */
    registerCors() {
        this.app.use(Cors(this.config.cors))
    }

    /**
     * Fetches all models and registers them into DI container
     */
    registerModelsIntoContainer() {
        Container.set(
            USER_MODEL,
            Mongoose.model('User', this.config.UserSchema)
        )
    }

    registerServices() {
        Container.set(
            USER_SERVICE,
            new this.config.UserService(Container.get(USER_MODEL))
        )

        Container.set(
            MAIL_SERVICE,
            new this.config.MailService(this.config.mail)
        )
    }

    registerRegistrationEventListeners() {
        if (this.config.disableRegistrationEventListeners) return

        const config = this.config.mail

        Container.get(EVENT_DISPATCHER).on(USER_REGISTERED, async user => {
            const mailName = 'confirm-email'
            // check if the user has created a confirm-email mail in their
            // configured views folder
            const mailFolder = process.cwd() + config.views

            const customMailConfig = {}

            if (!Fs.existsSync(`${mailFolder}/${mailName}`)) {
                customMailConfig.useCustomMailPaths = true

                customMailConfig.views = Path.resolve(__dirname, 'mails')
            }

            // if they have, then use that
            // if not, then use the default in the mails folder
            Container.get('mails.queue').add({
                data: user,
                mailName,
                customMailConfig,
                subject: 'Welcome to Kopter !!!',
                recipients: user.email
            })
        })
    }

    /**
     * Connects to mongoose or gracefully shuts down
     */
    establishDataseConnection() {
        return Mongoose.connect(process.env.MONGODB_URL, this.config.mongoose)
    }

    getAuthRouter() {
        const router = Express.Router()
        this.app.use('/auth', router)

        return router
    }

    extendIndicative() {
        extend('unique', {
            async: true,

            validate: (data, field) =>
                Container.get(USER_MODEL)
                    .findOne({ [field]: getValue(data, field) })
                    .then(user => (user ? false : true))
                    .catch(() => false)
        })
    }

    registerResponseHelpers() {
        this.app.use((request, response, next) => {
            Object.keys(StatusCodes).forEach(status => {
                const statusCode = StatusCodes[status]
                response[status] = data =>
                    response.status(statusCode).json({
                        code: status,
                        data
                    })
            })
            next()
        })
    }

    registerRoutes() {
        const router = this.getAuthRouter()

        router.post(
            '/register',
            asyncRequest(Container.get(RegisterController).register)
        )

        router.post(
            '/login',
            asyncRequest(Container.get(LoginController).login)
        )
    }

    initConsole() {
        this.registerEventEmitter()

        this.registerQueueWorkers()

        /**
         * Configure dotenv
         */
        if (this.config.dotenv) this.registerDotEnv()

        this.registerModelsIntoContainer()

        this.registerServices()

        return this
    }

    /**
     *
     * Initialize the express application
     * First try to connect to the database
     * If it fails, gracefully shut down
     *
     * @return Express.Application
     */
    init() {
        this.registerEventEmitter()

        /**
         * Configure dotenv
         */
        if (this.config.dotenv) this.registerDotEnv()

        /**
         * Configure pino logger
         */
        if (this.config.pino) this.registerPinoLogger()

        this.registerQueueWorkers()

        return (
            this.establishDataseConnection()

                /**
                 * If a successful database connection is established,
                 *
                 */
                .then(() => {
                    /**
                     * Register all mongoose models into container
                     */
                    this.registerModelsIntoContainer()

                    this.registerServices()

                    this.registerRegistrationEventListeners()

                    this.extendIndicative()

                    this.registerResponseHelpers()

                    /**
                     * Configure body parser
                     */
                    if (this.config.bodyParser) this.registerBodyParser()

                    /**
                     * Disable x-powered-by
                     */
                    if (this.config.disableXPoweredByHeader)
                        this.disableXPoweredByHeader()

                    /**
                     * Configure Cors
                     */
                    if (this.config.cors) this.registerCors()

                    this.registerRoutes()

                    return this.app
                })

                .catch(e => {
                    console.log(e)
                    // TODO: Gracefully shut down the system
                    // maybe send a notification that things are broken.
                    return Promise.reject(e)
                })
        )
    }
}

module.exports = Kopter
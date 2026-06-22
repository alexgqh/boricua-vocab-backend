import 'dotenv/config' // Load the environment variables
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
const port = 5000

const app = express()

//create logger to track incoming requests (if in dev mode)
if (process.env.ENVIRONMENT === 'dev') {
  function logger(req, _, next) {
    console.log(`Request receieved: ${req.originalUrl}`)
    next()
  }
  app.use(logger)
}

//middleware used to read incoming JSON data
app.use(express.json())

//needed to read cookies
app.use(cookieParser())

//boilerplate code that allows us to read request bodies
app.use(express.urlencoded({ extended: true }))

//prevents browser from blocking incoming requests from a different origin
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}))

//create /words/* endpoint routes
import wordsRouter from './routes/words.js'
app.use('/words', wordsRouter)

//create /admin/* endpoint routes
import adminRouter from './routes/admin.js'
app.use('/admin', adminRouter)

//launch app on specified port
app.listen(port, () => console.log(`Server started on port ${port}`))
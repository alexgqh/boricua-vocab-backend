import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
const port = 5000

const app = express()

app.use(express.json()) //middleware used to read incoming JSON data
app.use(cookieParser()) //needed to read cookies
app.use(express.urlencoded({ extended: true })) //boilerplate code that allows us to read request bodies
app.use(cors({ //prevents browser from blocking incoming requests from a different origin
  origin: 'http://localhost:3000',
  credentials: true
}))

// app.get('/', (req, res) => {
//   res.status(404).send('<h1>Home path not defined</h1>')
// })

import wordsRouter from './routes/words.js'
app.use('/words', wordsRouter)

import adminRouter from './routes/admin.js'
app.use('/admin', adminRouter)

app.listen(port, () => console.log(`Server started on port ${port}`))
const	router =			require('express').Router(),
		Boom =				require('boom'),
		asyncHandler =		require('../middlewares/async'),
		auth =				require('../middlewares/auth'),
		upload =			require('../middlewares/upload'),
		dbUser =			require('../store/user'),
		dbProduct =			require('../store/product'),
		dbMarket =			require('../store/market'),
		checker =			require('../plugins/checker'),
		analyse =			require('../plugins/analyse'),
		uploadPlugin =		require('../plugins/upload'),
		tasks =				require('../plugins/tasks');


// TODO require user and check user equal change

/* uploads routes */
router.post('/upload/image',auth.requireUser, upload.handleImage, (req, res) => {
	res.json({
		filename: req.file.filename,
	});
})

/* search routes */
router.get('/s/:searched', asyncHandler(async (req, res) => {
	var products = await dbProduct.getMany({ search: req.params.searched });
	analyse.images(products);
	analyse.tags(products);
	await analyse.currencies(products);

	res.json(products);
}))

/* Auth */
router.post('/auth/login', auth.login)

router.post('/auth/register', auth.register)

router.route('/me')
 	.get(auth.requireUser, asyncHandler(async (req, res) => {
		var user = await dbUser.get(req.user.userId);

		res.json(user);
	}))
	.patch(auth.requireUser, (req, res) => {
		var cleanUser = checker.user(req.body)

		uploadPlugin.storeFiles([cleanUser.user_image])
			.then(async () => {
				await dbUser.patch(req.user, cleanUser)
				res.sendStatus(200)
			})
			.catch(err => {
				console.log(err);
			})
	})
	.delete(auth.requireUser, asyncHandler(async (req, res) => {
		await dbUser.deleteUser(req.user.userId);

		res.sendStatus(200);
	}))

router.get('/status', auth.requireUser, asyncHandler(async (req, res) => {
	var userStatus = {};
	var user = await dbUser.get(req.user.userId);
	// TODO Query 2 times user in start ? (/me and /status)
	// TODO Do in parallel

	userStatus.nb_messages = await dbUser.getNbMessages(req.user.userId, user.seen_messages_id);
	userStatus.nb_notifications = await dbUser.getNbNotifications(req.user.userId, user.seen_notifications_id);

	res.json(userStatus);
}))


/* product routes */
router.get('/products', asyncHandler(async (req, res) => {
	var products = await dbProduct.getMany(req.query);

	analyse.images(products);
	analyse.tags(products);
	await analyse.currencies(products);
	res.json(products);
}))

router.route('/product')
 	.post(auth.requireUser, (req, res) => {
		var cleanProduct = checker.product(req.body)

		if (!cleanProduct)
			return reject(Boom.badData())

		cleanProduct.creator_id = req.user.userId;

		uploadPlugin.storeFiles(cleanProduct.images)
			.then(async (ret) => {
				cleanProduct.images = JSON.stringify(ret);
				var productId = await dbProduct.add(cleanProduct)

				res.json({
					product_id: productId
				})
			})
			.catch(err => {
				console.log(err);
			})
	})

	.patch(auth.requireUser, asyncHandler(async (req, res) => {
		var cleanProduct = checker.product(req.body)
		if (!cleanProduct)
			return reject(Boom.badData())

		delete cleanProduct.images
		await dbProduct.patch(cleanProduct, req.user.userId, req.body.productId)
		res.sendStatus(200)
	}))

router.route('/product/:productId')
 	.get(asyncHandler(async (req, res) => {
		var product = await dbProduct.get(req.params.productId)
		await analyse.currencies([product]);
		res.json(product)
	}))
	.delete(auth.requireUser, asyncHandler(async (req, res) => {
		await dbProduct.delete(req.user.userId, req.params.productId);
		res.sendStatus(200)
	}))

router.get('/product/:productId/ratings', asyncHandler(async (req, res) => {
	var ratings = await dbProduct.getRatings(req.params.productId);

	res.json(ratings)
}))

router.patch('/product/:productId/tags', auth.requireUser, asyncHandler(async (req, res) => {
	await dbProduct.updateTags(req.params.productId, req.body)

	res.sendStatus(200)
}))

router.get('/user/:userId', asyncHandler(async (req, res) => {
	var user = await dbUser.get(req.params.userId)

	res.json(user)
}))

router.route('/market')
	.patch(auth.requireUser, (req, res) => {
		var cleanMarket = checker.market(req.body);

		if (Object.keys(cleanMarket).length === 0)
			throw Boom.badData();

		uploadPlugin.storeFiles([cleanMarket.market_background])
			.then(async () => {
				await dbMarket.patch(req.user.userId, cleanMarket);
				res.sendStatus(200);
			})
	})

router.get('/user/:userId/market', asyncHandler(async (req, res) => {
	var market = await dbMarket.get('userId', req.params.userId);

	if (req.query.tags)
		market.tags = await dbMarket.getTags(market.user_id);
	res.json(market);
}));

router.route('/market/:identifier')
	.get(asyncHandler(async (req, res) => {
		var market = await dbMarket.get('identifier', req.params.identifier);

		if (req.query.tags)
			market.tags = await dbMarket.getTags(market.user_id);
		res.json(market);
	}))

router.route('/orders')
 	.post(auth.requireUser, asyncHandler(async (req, res) => {
		await dbUser.order(req.user.userId, checker.order(req.body));

		res.sendStatus(200);
	}))
	.get(auth.requireUser, asyncHandler(async (req, res) => {
		var orders = await dbUser.getOrders(req.user.userId);

		res.json(orders)
	}))

router.route('/order/:orderId')
 	.get(auth.requireUser, asyncHandler(async (req, res) => {
		var order = await dbUser.getOrder(req.params.orderId);

		res.json(order);
	}))
	.delete(auth.requireUser, asyncHandler(async (req, res) => {
		//TODO Check is possible and userid ok
		await dbUser.cancelOrder(req.user.userId, req.params.orderId)

		res.sendStatus(200)
	}))

router.get('/conversations', auth.requireUser, asyncHandler(async (req, res) => {
	var conversations = await dbUser.getConversations(req.user.userId);

	res.json(conversations)
}))

router.route('/messages/:contactId')
	.get(auth.requireUser, asyncHandler(async (req, res) => {
		var messages = await dbUser.getMessages(req.user.userId, req.params.contactId)

		res.json(messages)
	}))

	.post(auth.requireUser, asyncHandler(async (req, res) => {
		var message = req.body.message;
		if (req.user.userId == req.params.contactId)
			return res.sendStatus(400)
		//TODO Add validator to it
		await dbUser.postMessage(req.user.userId, req.params.contactId, message);
		res.sendStatus(200);
	}))

/* error handler */
router.use((err, req, res, next) => {
	if (err.isBoom) {
		res.status(err.output.statusCode).json(err.output.payload);
	} else {
		console.log(err);
		res.sendStatus(400);
	}
})

module.exports = router;

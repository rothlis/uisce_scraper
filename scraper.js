var _       = require('underscore');
var $q      = require('q');

var request = require('request');
var qs      = require('qs');
var cheerio = require('cheerio');

var mongo   = require('mongodb');
var monk    = require('monk');
var db      = monk('localhost:27017/uisce-development');

var debug   = require('debug')('scrapper');

var Whisky = (function () {

  var Whisky = function (value) {
    var instance = this;

    // Default values
    instance.priceCurrency = "CAD";
    instance.references = [];

    return _.extend(instance, value || {});
  };

  Whisky.prototype.parseHTML = function(data) {
    // Name
    this.name = data.find('.nom').first().text().trim();

    // Image
    image = data.children().first().find('img').first();
    this.image = image.attr('src');

    // Url
    this.url  = image.parent().attr('href');

    // Flavor
    try{
      this.flavor = data.find('.flavor img').first().attr('title').split(':')[1].trim();
    }catch(e){}

    // Price
    this.price = parseFloat(data.find('.price a').first().text().trim().replace('$',''));

    // Reference
    this.references.push({
      referenceId: parseInt(image.attr('id')),
      referenceSource: 'SAQ',
      referenceLastUpdatedAt: Date()
    });

    return this;
  };

  return Whisky;

})();

debug('Scraping in debug mode...');

var whiskies = db.get('whiskies');

var totalWhiskies = null;

var baseUrl = 'http://www.saq.com/webapp/wcs/stores/servlet/SearchDisplay';

var params = {
  orderBy: 1,
  categoryIdentifier: '0508',
  showOnly: 'product',
  langId: '-1',
  beginIndex: '',
  metaData: '',
  pageSize: 100,
  catalogId: 50000,
  pageView: 'list',
  searchTerm: '*',
  facet: '',
  selectedTab: 'product',
  storeId: 20002,
  filterFacet: ''
}

var countPageRemaining = function() {
  return Math.ceil((totalWhiskies - params.beginIndex) / params.pageSize)
}

var processWhiskiesOnPage = function(html) {
  var $ = cheerio.load(html);

  if (totalWhiskies === null){
    totalWhiskies = parseInt($(".rechercheNb").first().text().match(/(\d+)/)[0])
  }

  $(".resultats_product").each(function(){
    var whisky = new Whisky().parseHTML($(this));
    whiskies.update({
      "references.referenceId": {$eq: whisky.references[0].referenceId},
      "references.referenceSource": {$eq: whisky.references[0].referenceSource}
    }, whisky, { upsert: true });
  });
};

var buildPageUrl = function(page) {
  params.beginIndex = (page - 1) * params.pageSize;
  return baseUrl + '?' + qs.stringify(params);
};

var processPage = function(page) {
  var defer = $q.defer();
  var url = buildPageUrl(page);
  debug('Navigating to: ' + url);
  request(url, function(error, response, html){
    if(!error){
      debug('Starting page ' + page + '...');
      processWhiskiesOnPage(html);
      defer.resolve();
    } else {
      debug('Error on page ' + page + '.');
      debug(error);
      defer.reject(error);
    }
  });
  return defer.promise;
};

var processAllPages = function(){
  var defer = $q.defer();
  var promises = [];
  processPage(1).then(function(){
    _.times(countPageRemaining(), function(index){
      promises.push(processPage(index + 2));
    })
    $q.all(promises).then(function(){
      debug('All done.');
      defer.resolve();
    });
  })
  return defer.promise;
}

processAllPages().then(function(){
  db.close();
  debug('All done.');
});
// variables prefixed with $ are global
// all others are local to their functions, or should be

// abreviated document elements
var $d; // document
var $b; // body element
// DIV element holding for departures list
var $pbox;
// global map layers
var $m = null; // map object
var $vehicles; // vehicle markers layer
var $vcircles; // off-screen circles layer
var $vpointers; // vehicle pointers layer
var $lines; // lines/routes layer

// global tells us whether to run advanced development features
// to run, add dev=yes to query string
var $dev = false;

// global stops layer, for selecting stops if selection app running, else a list with stop ids as keys for their locations if the general app is running
var $stops = {}; 
// list of headings for quick lookup once calculated
var $headings = {};
// list of stop ids already rendered on selection map
// used to prevent overdrawing
var $stopsRendered = []; 
// global reference to the circleMarker showing the active stop location
var $stopCircle; 
// shape id of shape currently rendered
var $activeShape = 'not a real shape id yet but it will be'; 
// Graphic SETTINGS
var $defaultZoomLevel = 17;
var $defaultCenter = [39.11164,-84.51621];
var $radius = 50; // pixels radius of $stopCircle
var $margin = 50; // margin used for off-screen circles, in pixels
// bounds object (screen coordinates) defining inset of margin from map bounds
var $margin_bounds;
// global shapes object with shape ids and lists of coordinates 
var $shapes = {}; 
// icon definitions for selected and unselected stops
// easiest just to define them once and reference
var $redIcon;
var $blueIcon;
// list of shapeIDs that have already had requests made for them. 
// no need to remove these once the results are in
var $shapeQueue = [];
// interval ID for main repeating departure request function
// used stored when interval is set and used to reset the interval 
// when things slow down
var $intervalState = {'id':null,'time':29};




// functions for finding data about the next predicted departure
function stopLocation(stop_id){ // defaults to current
	if(stop_id == undefined){ stop_id = currentStopId(); }
	if($stops[stop_id] == undefined){ stop_id = currentStopId(); }
	return $stops[stop_id].location;
}
function currentRouteColor(){
	return $pbox.childNodes[0].getAttribute('style').substring(11);
}
function currentShapeId(){
	return $pbox.childNodes[0].getAttribute('shape');
}
function currentStopId(){
	return $pbox.childNodes[0].getAttribute('class').substring(4);
}

// project and unproject points. mask for overly long names
// lat-lon to pixel
function lToP(latLngObject){
	return $m.latLngToContainerPoint(latLngObject);
}
// pixel to lat-lon
function pToL(point){
	return $m.containerPointToLatLng(point);
}



// initialize onload by getting some global elements
// then pass the ball to stop string validation
function start(){
	$d = document;
	$b = $d.getElementsByTagName('body')[0];
	$pbox = $d.getElementById('predictionBox');
	if (getParameterByName('dev') != null) { 
		if (getParameterByName('dev') == 'yes') { $dev = true; }
	}
	var stops = getParameterByName('stops');
	if (getParameterByName('stops') == null) { 
		startStopLookupApp(); 
	}else{
		validateStops();
	} 

}

// check if we have been fed some valid stop ids
// if we have, continue to the display and set the global stops variable
// if not, display the stop selection screen
function validateStops(){
	var stops = getParameterByName('stops');
	stops = stops.split(',');
	// assign to global object
	for(i=0;i<stops.length;i++){ // for each stop
		$stops[stops[i]] = {'location':null};
	}
	for(var stop_id in $stops){ // for each stop
		// find the location
		console.log('requesting position of stop '+stop_id+' at '+Date.now());
		findStop(stop_id);
	}
}

// determine whether all stop locations have been found
// when they have been found, make the map and 
// request departure 
function foundStops(){
	for(var stop_id in $stops){
		if($stops[stop_id].location == null){
			//havn't found all the stops yet
			return null;
		}
	}
	// stops are found: make stuff happen
	makeTheMap();
	// makes departure requests for all stops
	callGetTimes();
	// keeps doing that
	$intervalState.id = setInterval(function(){callGetTimes()},30000); // 30 seconds
}

// return a heading between 0 - 359.999 for a given shape_id and stop_id
// calculate the bearing from the stop to the end of the shape
// return null if anything is wrong or if data is not yet available
// null return should display:none the heading arrow
function getHeading(stop_id, shape_id){
	// if it's already been calculated, just return it
	if($headings[stop_id] != undefined){
		if($headings[stop_id][shape_id] != undefined){
			return $headings[stop_id][shape_id]; 
		}
	}
	// if the heading hasn't been calculated, see if we have the shape 
	// we need to calculate it. If we don't have what we we need, it 
	// means he data has not  been recieved yet and we should simply 
	// wait until the next cycle brings us back here to try again
	if($shapes[shape_id] == undefined){
		getShape(shape_id);
		return null;
	}
	// get the last point of the shape and the stop location
	var last_key = $shapes[shape_id].coords.length-1;
	var last_point = $shapes[shape_id].coords[last_key];
	var stop_loc = stopLocation(stop_id);
	// convert those into screen/projected coordinates
	var p1 = lToP(stop_loc);
	var p2 = lToP(last_point);
	var theta = Math.atan2(
		p2.x-p1.x,
		p1.y-p2.y // inverted! Twice!
	);
	var result = theta*180/Math.PI
	// store this so we don't have to calculate it again
	if($headings[stop_id] == undefined){ 
		$headings[stop_id] = {};
		$headings[stop_id][shape_id] = result;
	}else{
		$headings[stop_id][shape_id] = result;
	}
	// and return
	return result;
} 

// create the map and start the app for stop selection
function startStopLookupApp(){
	$b.setAttribute('class','stop_selector_app')
	$m = L.map('map',{
		'center': $defaultCenter,
		'zoom': $defaultZoomLevel,
		'zoomControl': false,
		'attributionControl':false,
		'animate':true
	});
	// standard OSM map layer. Detailed map to help people locate the stop(s)
	L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo($m);
	// new layer for selectable stops
	$stops = new L.FeatureGroup();
	$stops.addTo($m);
	// define the icon classes for selected and unselected stops
	defineIcons();
	// make the map look for new stops when moved
	$m.on('moveend',addStops);
	// make it look for stops now
	addStops();
}

// define two global icons
function defineIcons(){
	$blueIcon = L.icon({
		'iconUrl':'markers/blue-marker.svg',
		'iconAnchor':[20,35]
	});
	$redIcon = L.icon({
		'iconUrl':'markers/red-marker.svg',
		'iconAnchor':[20,35]
	});
}

// load new selectable stops on each map moveend
function addStops(){
	// from the center of the map
	var c = $m.getCenter(); 
	var r = new XMLHttpRequest();
	r.open(
		'get', 
		'http://app.busdetective.com/api/stops?per_page=200&latitude='+c.lat+'&longitude='+c.lng, 
		true);
	r.onreadystatechange = function(){
		if(r.readyState == 4){ // finished
			if(r.status == 200){ // got good response
				var data = JSON.parse(r.responseText);
				var results = data.data.results;
				for(i=1; i<results.length; i++){
					if(listHasKey($stopsRendered,results[i].id)){
						continue;
					} // add the stop since it hasn't alreay been rendered
					var m = L.marker(
						[results[i].latitude,results[i].longitude],
						{'icon':$blueIcon,'id':results[i].id}
					);
					m.addEventListener('click',stopClicked);
					$stops.addLayer(m);
					$stopsRendered[results[i].id] = 'blank';
				}
			}
		}
	}
	r.send();
}

// a stop has been clicked in the stop selector app
// change it's color
function stopClicked(event){
	if(event.target.options.icon == $blueIcon){
		event.target.setIcon($redIcon);
	}else if(event.target.options.icon == $redIcon){
		event.target.setIcon($blueIcon);
	}
}

// find the selected stops by their color and 
// start the app with those stops
function selectSelectedStops(){
	var selectedStops = [];
	$stops.eachLayer(function(layer){
		if(layer.options.icon == $redIcon){
			selectedStops.push(layer.options.id)
		}
	});
	// reload the page with the stops selected
	window.location.href = "http://www.cincymap.org/rt/index.html?stops="+selectedStops;
}


// get stop location and initiate the map when ready
// TODO add validation here too, returning to stop selection app if stop does not exist
function findStop(stop_id){
	var r = new XMLHttpRequest();
	r.open(
		'get',
		'http://app.busdetective.com/api/stops/'+stop_id,
		true);
	r.onreadystatechange = function(){
		if(r.readyState == 4){ // finished
			if(r.status == 200){ // got good response
				console.log('position data received for stop '+stop_id);
				var data = JSON.parse(r.responseText);
				$stops[stop_id]['location'] = L.latLng(
					data.data.latitude, 
					data.data.longitude
				);
				// set this now as well, since we're here
				// will be used if no departures are found
				// value is the number of departures returned to the last request
				$stops[stop_id]['incoming'] = true;
				foundStops(); // check if all stops have been found yet
			}
		}
	}
	r.send();
}

// call getTimes() for each stop
// only here because of apparent scope problems
// this function is called repeatedly by the timer
function callGetTimes(){
	for(var stop_id in $stops){
		console.log('requesting departures for stop '+stop_id+' at '+Date.now());
		getTimes(stop_id);
	}
}


// http request for a stop's upcoming arrival times
// on completion, sends to display
function getTimes(stop_id){
	var r = new XMLHttpRequest();
	r.open(
		'get',
		'http://app.busdetective.com/api/departures?stop_id='+stop_id, 
		true);
	r.onreadystatechange = function(){
		if(r.readyState == 4){ // finished
			if(r.status == 200){ // got good response
				var data = JSON.parse(r.responseText);
				// check if any departures were returned
				if(data.data.departures.length == 0){
					console.log('no departures returned for stop '+stop_id);
					gotNoDepartures(stop_id);
					return null;
				}else{
					gotDepartures();
				}
				// data looks good, so add new times to the display
				console.log('departure data received for stop '+stop_id+' at '+Date.now());
				placeNewTimes(stop_id, data.data.departures);
			}
		}
	}
	r.send();
}

// called when a departure request returns no results
// checks if other calls also found nothing and 
// takes action if necessary to slow down requests to server
// and alert the user that nothing is coming
function gotNoDepartures(stop_id){
	// are we already going slow? if so, we don't need to change anything
	if($intervalState.time > 30){ return null; }
	// make note that this stop has no incoming trips
	$stops[stop_id].incoming = false;
	// check all other stops for same
	// if any other stop has results, leave things alone
	for(id in $stops){
		if($stops[id].incoming == true){ return null;}
	}
	// if we've made it this far, none of the stops 
	// have any incoming trips
	console.log('no incoming trips found for any of these stops');
	console.log('slowing request frequency to once every two minutes');
	clearInterval($intervalState.id);
	$intervalState.id = setInterval(function(){callGetTimes()},120000);
	$intervalState.time = 60;
	// clear any shapes and vehicles from the map
	if($dev){
		$vehicles.clearLayers();
	}
	$lines.clearLayers();
	// TODO add message to user
	var e = $d.createElement('DIV');
	e.setAttribute('id','errorMessage');
	e.innerHTML = "There doesn't appear to be any transit running here in the next hour or so.";
	$b.appendChild(e);
}

// departures have been returned sucessfully, perhaps for the 
// first time in a while. Remove the error message if any 
// and return to normal operation from slowdown mode if necessary
function gotDepartures(){
	// things are already in normal operation
	if($intervalState.time < 30){ return null; }
	// things must have been running slowly. Time to wake up!
	console.log('returning to normal operation');
	console.log('requesting departures twice per minute');
	// start checking departures more frequently again
	clearInterval($intervalState.id);
	$intervalState.id = setInterval(function(){callGetTimes()},29000);
	$intervalState.time = 29;
	// remove the error message TODO check this is working
	var ediv = $d.getElementById('errorMessage');
	ediv.parentNode.removeChild(ediv);
}

// trim headsign into a shorter, more legible string
// or leave it alone if we don't know what to do with it
// this is only called by the place new times function
// but I've broken it out because that function is already long enough
// TODO some parts of headway are streets!
function trimHeadsign(headsign){
	if( /.owntown/.test(headsign) ){ // looking for "downtown", case insensitive
		return "to Downtown";
	}else{
		// remove bullshit	
		headsign = headsign.replace('Crosstown','');
		headsign = headsign.replace('Metroplus','Kenwood');
		// if multiple destinations, replace dashes with commas & ampersands
		var dests = headsign.split(' - ');
		// now check for and remove street names and other BS that is not a detination
		cut(dests,'Vine');
		cut(dests,'Casey');
		cut(dests,'Casey');
		cut(dests,'Madison Road');
		switch(dests.length){
			case 0:
				return '';
			case 1: 
				return 'to '+headsign;
			case 2:
				return 'to '+dests[0]+' & '+dests[1];
			case 3:
				return 'to '+dests[0]+', '+dests[1]+' & '+dests[2];
			case 4:
				return 'to '+dests[0]+', '+dests[1]+', '+dests[2]+' & '+dests[3];
		}
	}
	return headsign;
}

// remove a given element from an array if it exists
// array is passed by reference, so no return
function cut(array,value){
	var i = array.indexOf(value);
	if (i >= 0) {
		array.splice( i, 1 );
	}
}


// run after a certain time for every departure prediction. 
// prevents stale results in case of connection problems 
// or the like. Works by checking the time of last update
// and deleting the node if it's very old, updating the 
// prediction if it's only a little old. 
// Function is passed the li node of the prediction
// Note that while this updates the times, it does not 
// change the ordering of the predictions
function callCheckIfOld(node,seconds_of_delay){
	// only necessary because of variable scope issues
	var delay = seconds_of_delay * 1001;
	setTimeout(function(){checkIfOld(node);}, delay);
}
function checkIfOld(node){
	// if the node has been deleted, stop checking on it
	if( ! $b.contains(node) ){ return null; }
	// how long between now and the last update?
	var delta = Date.now() - node.getAttribute('updated_at');
	// if older than 2 minutes, delete the node
	if(delta > 120000){
		node.parentNode.removeChild(node);
		return null;
	}
	// update the time if necessary
	var p = fromNow(node.getAttribute('prediction'));
	node.getElementsByClassName('time')[0].innerHTML = (p.m == -1 ? 0 : p.m);
	setTimeout(function(){checkIfOld(node);}, p.flip_in*1001);
}


// take a list of departures from one stop and add them to the display
// replacing any previous predictions
function placeNewTimes(stop_id, departures){
	// clear previous predictions for this stop only
	var dlist = $pbox.getElementsByClassName('sid_'+stop_id);
	while(dlist.length > 0){
		dlist[0].parentNode.removeChild(dlist[0]);
	}
	// get a live list of what remains in the displayed list
	var current_list = $pbox.childNodes;
	// now make the new predictions into list items and 
	// slot them into the right places
	departure_loop:
	for(i=0; i<departures.length; i++){ // for each predicted departure
		// get time from now
		var until = fromNow(departures[i].time);
		if(until.m < 0){ continue; } // if time already passed TODO allow for scheduled late buses
		var headsign = departures[i].trip.headsign;
		var shape_id = departures[i].trip.shape_id;
		var route = departures[i].route.short_name;
		// reset route name for XTRA routes TODO verify that this is working and displaying well
		if(route.length > 2){ route = 'XT'; }
		// creat list item
		var li_node = $d.createElement("LI");
		// assign the route color as the box background color
		li_node.setAttribute('style','background:#'+departures[i].route.color);
		li_node.setAttribute('class','sid_'+stop_id);
		li_node.setAttribute('stop_id',stop_id);
		li_node.setAttribute('shape',shape_id);
		li_node.setAttribute('realtime',departures[i].realtime);
		li_node.setAttribute('trip_id',departures[i].trip.id);
		li_node.setAttribute('updated_at',Date.now());
		li_node.setAttribute('prediction',departures[i].time);
		// create node with arrival time
		var time_node = $d.createElement("SPAN");
		// add extra class in case two digit number
		time_node.setAttribute('class','time'+(until.m>=10?" two-digit":''));
		time_node.innerHTML = until.m;
		// create node with heading arrow image
		var arrow_node = $d.createElement("IMG");
		arrow_node.setAttribute('src','arrow.svg');
		arrow_node.setAttribute('class','arrow');
		// find and set the heading, possibly no heading
		var heading = getHeading(stop_id,shape_id);
		if(heading === null){
			arrow_node.setAttribute('class','arrow not-ready');
		}else{
			arrow_node.setAttribute('style','transform:rotate('+heading+'deg)');
		}
		// create the node with the headsign
		var headsign_node = $d.createElement("SPAN");
		headsign_node.setAttribute('class','headsign');
		headsign_node.innerHTML = trimHeadsign(headsign);
		// create the node with the route_short_name
		var route_node = $d.createElement("SPAN");
		route_node.setAttribute('class','route');
		route_node.innerHTML = departures[i].route.short_name;
		// add text bits to LI node
		li_node.appendChild(arrow_node);
		li_node.appendChild(headsign_node);
		li_node.appendChild(route_node);
		li_node.appendChild(time_node);
		// check back in a bit to see if we need to update anything
		callCheckIfOld(li_node);
		// go through the current list until a slot is found for this prediction
		list_loop:
		for(j=0; j<current_list.length; j++){
			var this_time = current_list[j].getElementsByClassName('time')[0];
			if( until.m <= parseInt(this_time.innerHTML) ){
				$pbox.insertBefore(li_node,current_list[j]);
				continue departure_loop;
			}
		}
		// if nothing is smaller, or nothing exists, insert at end of list
		$pbox.appendChild(li_node);
	}
	// if route already mentioned, don't render its number
	var routes = {};
	for(i=1; i<current_list.length; i++){ // skip the first item
		var route_node = current_list[i].getElementsByClassName('route')[0];			
		if (routes[route_node.innerHTML] == undefined){
			//route_node.setAttribute('style','');
			routes[route_node.innerHTML] = 'displayed';
		}else{
			route_node.setAttribute('style','display:none');
		}
	}
	// in moment, check that the map display matches the next arrival
	// this short wait allows multiple updates to come in 
	// ensureing that we don't just run this twice in quick succession
	setTimeout( function(){updateMap();}, 1500);
}

// ensure that the map display matches the next scheduled arrival
// called after times are updated
function updateMap(){
	// if the correct shape isn't already loaded
	if( currentShapeId() == $activeShape ) { return null; }
	// leaflet update circleMarker on stop
	$stopCircle.setLatLng( stopLocation() );
	// clear any shapes and vehiclesfrom the map
	if($dev){
		$vehicles.clearLayers();
	}
	$lines.clearLayers();
	// we don't have the shape, so request it and wait until this is called again
	if($shapes[ currentShapeId() ] == undefined ){
		getShape( currentShapeId() );
		return null;
	}
	// place the proper shape if we already have it
	placeShape($shapes[ currentShapeId() ].coords);
	// mark what is shortly to be done
	$activeShape = currentShapeId();
	return null;
}


// request a shape, store the data, come back for it later probably
function getShape(shape_id){
	shape_id = String(shape_id);
	// check to see whether this shape has already been requested
	if($shapeQueue.indexOf(shape_id) >= 0){ return null;}
	// shape has not been requested, so request it
	$shapeQueue.push(shape_id);
	console.log('requesting shape '+shape_id+' at '+Date.now());
	var r = new XMLHttpRequest();
	r.open(
		'get', 
		'http://app.busdetective.com/api/shapes/'+shape_id,
		true);
	r.onreadystatechange = function(){
		if(r.readyState == 4){ // finished
			if(r.status == 200){ // got good response
				var data = JSON.parse(r.responseText);
				console.log('received data for shape '+shape_id+' at '+Date.now() );
				// now store the shape so we don't look it up again
				storeShape(shape_id,data.data.coordinates);
			}
		}
	}
	r.send();
}


// creates the map
function makeTheMap(){
	$b.setAttribute('class','the_app')
	for(var stop_id in $stops){ // map initializes on first stop because it has to be one of them
		var firstStop = stop_id;
		break;
	}
	// leaflet start map
	$m = L.map('map',{
		'center': $stops[firstStop].location,
		'zoom': $defaultZoomLevel,
		'zoomControl': false,
		'attributionControl':false,
		'animate':true
	});
	// Stamen Toner tiles
	L.tileLayer('http://stamen-tiles-c.a.ssl.fastly.net/toner/{z}/{x}/{y}.png').addTo($m);
	// create layers to be used in a moment
	$lines = new L.FeatureGroup();
	// add layers to map
	$lines.addTo($m);
	if($dev){
		// create and add vehicle location map layers if in dev mode
		$vcircles = new L.FeatureGroup();
		$vpointers = new L.FeatureGroup();
		$vehicles = new L.FeatureGroup();
		$vcircles.addTo($m);
		$vpointers.addTo($m);
		$vehicles.addTo($m);
		// set event listener for zooms
		$m.on('move',drawLines);
	}
	// add the stop marker, but way off the screen. 
	// location will be updated when we have it
	$stopCircle = L.circleMarker(
		[10,10],
		{'radius':$radius, 'stroke':true, 'fill':false, 
			'color':'#F00', 'opacity':0.8, 'clickable':false,
			'keyboard':false, 'weight': 8}
	);
	$stopCircle.addTo($m);
}

// check if the shape is already stored in $shapes
function listHasKey(list,key){
	if(list[key] == undefined){
		return false;
	}else{
		return true;
	}
}
// if not haveShape, storeShape!
function storeShape(shape_id,coordinates){
	$shapes[shape_id] = {'coords':coordinates,'stops':{}};
	return null;
}

// slice the line shape at the stop, returning two parts.
// do this by starting at the beginning and measuring 
// the distance from each point to the stop, eventually 
// selecting the closest one after going through all of them
// it's ugly and there must be a better way but it should 
// work well enough
function sliceShape(coords){
	var location = stopLocation();
	var mindist = Infinity;
	var parallel_array = [];
	for(i=0; i<coords.length; i++){
		var up = coords[i][0] - location.lat;
		var over = coords[i][1] - location.lng;
		parallel_array[i] = euclid(up,over);
		if( parallel_array[i] < mindist ){
			mindist = parallel_array[i];
		}
	}
	i = 0;
	while(parallel_array[i] != mindist){
		i++;
	} // i is now the index of the closest point
	return {'pre':coords.slice(0,i+1),'post':coords.slice(i)};
}


// place the shape on the map
function placeShape(coordinates){
	// slice the line at the stop
	var temp = sliceShape(coordinates);
	var preCoords = temp.pre;
	var postCoords = temp.post;
	// set line values
	var options = {'color':currentRouteColor(),'weight':9,'opacity':0.95};
	var lineAfter = new L.polyline(postCoords,options);
	options.opacity = 0.55;
	var lineBefore = new L.polyline(preCoords,options);
	// add the new one
	$lines.addLayer(lineAfter);
	$lines.addLayer(lineBefore);
	// put the circle back on top
	$stopCircle.bringToFront();
	// now zoom the map so the whole thing is visible, at least momentarily
	$m.fitBounds(lineAfter.getBounds());
	setTimeout(function(){ 
		$m.panTo( stopLocation() );
		//$m.panBy( mapCenter() );
	}, 3000);
	setTimeout(function(){ zoomInALittle(); }, 8000);
	// set some random vehicle locations for testing
	if($dev){
		randomLocations(coordinates);
	}
}

// TODO fix this or scrap it
// return offset of the center of the visible map 
// from the center of the whole map 
function mapCenter(){
	// get the center point of the map
	var mc = lToP( $m.getBounds().getCenter() );
	// and the center point for the margin bounds
	var mb = getMarginBounds();
	var marc = L.point(
		mb.max.x - mb.min.x,
		mb.max.y - mb.min.y
	);
	console.log(mc);
	console.log(marc);
	console.log(L.point( mc.x-marc.x, mc.y-marc.y ));
	return L.point( 0, 0 ); 
}

// zoom back in to the default zoom level one step at a time
function zoomInALittle(){
	// if we aren't already at the right spot...
	if($m.getZoom() < $defaultZoomLevel){
		$m.zoomIn(1);
		// go in a little further if necessary by recursing
		setTimeout(function(){ zoomInALittle(); }, 6000);
	}
	return null;
}

// take string date and return the time from this very moment 
// in both seconds and rounded to the nearest minute
// also include the time until the minute flips to the 
// next rounded value down
function fromNow(datestring){
	var time = new Date(datestring);
	var seconds = ( time.getTime() - Date.now() ) / 1000.0;
	var minutes = Math.round(seconds/60);
	var flip = Math.ceil(seconds - (minutes-0.51)*60);
	return {'s':seconds,'m':minutes,'flip_in':flip};
}

// random coordinates from list of random coordinates, placed on map
function randomLocations(coordinates){
	$vehicles.clearLayers();
	for(i=0; i<5; i++){
		var selected = Math.floor(Math.random() * coordinates.length);
		var point = L.latLng(coordinates[selected]);
		$vehicles.addLayer(L.marker(point));
	}
}






// draw lines to vehicles and circles to margin bounds
function drawLines(){
	// clear whatever has been added to the map
	$vcircles.clearLayers();
//	$vpointers.clearLayers();
	// get the bounds of the margin at this moment
	getMarginBounds();
	//iterate through all vehicles on the map
	$vehicles.eachLayer(function(layer){
		var vehicle_loc = layer.getLatLng();
		var screen_vehicle_loc = lToP(vehicle_loc);

		if(! $margin_bounds.contains(screen_vehicle_loc)){ // outside of margin bound
//			var linegeom = trimmed_line($stop_loc,vehicle_loc);
//			$vpointers.addLayer(
//				L.polyline(
//					linegeom,
//					{stroke:true, fill:false, color:'#f00', opacity:0.5}
//				)
//			);
			// draw a circle with r = distance from margin bound
			var radius = distanceToMargin(screen_vehicle_loc);
			$vcircles.addLayer(
				L.circleMarker( 
					vehicle_loc, 
					{
						'radius':radius, 'color':currentRouteColor(),
						'fillOpacity':0.1, 'weight':4, 'dashArray':'20,20',
						'opacity':0.9
					} )
			);
		}
	});

	$m.addLayer($vcircles);
//	$m.addLayer($vpointers);
}


// calculate the distance from the margin to a point outside of it
// passed a point with pixel coordinates
function distanceToMargin(p){
	var w = $margin_bounds.min.x;
	var e = $margin_bounds.max.x;
	var n = $margin_bounds.min.y;
	var s = $margin_bounds.max.y;
	if(p.x > e){ // east of
		if(p.y > s){ // east and south of
			return euclid(s-p.y,p.x-e);
		}else if(p.y < n){ // east and north of
			return euclid(n-p.y,p.x-e);
		}else{ // just east of
			return euclid(p.x-e,0);
		}
	}else if(p.x < w){ // west of
		if(p.y < n){ // west and north of
			return euclid(w-p.x,n-p.y);
		}else if(p.y > s){ // west and south of
			return euclid(p.x-w,s-p.y);
		}else{ // just west of
			return euclid(p.x-w,0);
		}
	}else if(p.y > s){ // south of
		return euclid(p.y-s,0);
	}else if(p.y < n){ // north of
		return euclid(n-p.y,0);
	}else{ // inside of
		console.log('inside margin! Fix me!');
	}
}

// calculate euclidean distance from two perpendicular lengths
function euclid(a,b){
	return Math.sqrt( Math.pow(a,2) + Math.pow(b,2) );
}

// return a bounds object, stepped in by the margin in pixels
function getMarginBounds(){
	// check for portrait/landscape
	if($b.getBoundingClientRect().height > $b.getBoundingClientRect().width){
		// if portrait
		var left_pad = 0;
	}else{
		var left_pad = $pbox.childNodes[0].getBoundingClientRect().width;
	}
	var right_pad = $pbox.getBoundingClientRect().width;
	// convert to pixel values
	var ne_point = lToP( $m.getBounds()._northEast );
	var sw_point = lToP( $m.getBounds()._southWest );
	// add/subtract the margin and the arrivals list
	ne_point.x -= $margin + right_pad;
	ne_point.y += $margin;
	sw_point.x += $margin + left_pad;
	sw_point.y -= $margin;
	// create and store the bounds object
	$margin_bounds = L.bounds(ne_point,sw_point);
	return $margin_bounds;
}

/*
// cut r pixels off of line p1 -> p2 from p1 side
function trimmed_line(p1,p2){
	// project to screen pixels from geo coordinates
	p1 = lToP(p1);
	p2 = lToP(p2);
	// do math
	// get length of the original line
	width = Math.abs(p1.x-p2.x);
	height = Math.abs(p1.y-p2.y);
	s1 = Math.pow(width,2);
	s2 = Math.pow(height,2);
	length = Math.sqrt(s1+s2);

	if(radius >= length){ // if inside circle, no line
		return [];
	}
	to_remove = radius/length;
	np1 = p1;	
	np1.x = p1.x - (p1.x-p2.x)*to_remove;
	np1.y = p1.y - (p1.y-p2.y)*to_remove;
	//unproject and return
	np1 = pToL(np1);
	p2 = pToL(p2);
	return [np1,p2];
}
*/

// pan the map to the user's location
function getMyLocation(){
	// get the location and pan to it
	navigator.geolocation.getCurrentPosition(function(position){
		$m.panTo([position.coords.latitude,position.coords.longitude]);
	});
}

// fullscreen the page
function makefull(){
	element = $d.documentElement;
  if(element.requestFullscreen) {
    element.requestFullscreen();
  } else if(element.mozRequestFullScreen) {
    element.mozRequestFullScreen();
  } else if(element.webkitRequestFullscreen) {
    element.webkitRequestFullscreen();
  } else if(element.msRequestFullscreen) {
    element.msRequestFullscreen();
  }
}

// unfullscreen the page
function unfill(){
  if($d.exitFullscreen) {
    $d.exitFullscreen();
  } else if($d.mozCancelFullScreen) {
    $d.mozCancelFullScreen();
  } else if($d.webkitExitFullscreen) {
    $d.webkitExitFullscreen();
  }
}

// get the value of a query string parameter
function getParameterByName(name) {
    var match = RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
    return match && decodeURIComponent(match[1].replace(/\+/g, ' '));
}

/*
PROGRAM DESIGN NOTES
basically, update when there is new data and let the changes cascade through the rest of the app.
Function placement in the code should follow roughly the order below
 
start
validate stops
	if fail
		start stop lookup app
	if success
		request all stops
			if any fail start stop lookup app TODO
			initialize map on random stop location
	-		request departure times for each stop
				remove any previous departure times for the stop from the displayed list
				add new departures in the correct slots/order
					mark first departure for the prime position
						now we have the first/next departure
							add stop location to map
								get vehicle location
									display it
									render stuff if off-screen
								get shape data
									display it
									start zoom/pan animation


*/

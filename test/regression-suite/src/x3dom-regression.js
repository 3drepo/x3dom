var webdriver = require("selenium-webdriver");
var fs = require("fs");
var rmdir = require("rimraf");

var ts = require("./testsuite.js");
var rp = require("./resultspublisher.js");


var configuration = "configuration.json";
globals = new Object();
globals.screenshotDelay = 100;
globals.referencePath = "test/reference/";

console.log("parsing args");
process.argv.forEach(function(val, index, array){
    if(index > 1)
    {
        if(val == '-c' || val == '--conservative')
        {
            console.log("Running in conservative mode");
            globals.screenshotDelay = 1000;
        }
        if(val == '-n' || val == '--no-aa')
        {

            console.log("Using reference folder: test/reference-no-aa");
            globals.referencePath = "test/reference-no-aa/";
        }
    }
});

function removeOutput(callback){
        //delete outfolder
        try{
            rmdir.sync("output",function(){
                console.log("Error removing output folder");
            });
        }catch(e){};
        fs.exists("output", function(exists){
            if(exists)
            {
                removeOutput(callback);
            }
            else
            {
                callback();
            }
        });
}

//read test configuration file and start regression
fs.readFile(configuration,function(err, data)
{
    if(err)
        console.log("Could not find configuration file: "+configuration);
    else
    {
        var config = JSON.parse(data);

        if(!config)
            console.log("Error reading configuration file: "+configuration);

        console.log("deleting output folder...");
        removeOutput(function(){

            //publishes the results as webpages
            var publisher = new rp.ResultsPublisher(config.outputPath);


            var currentProfile = 0;
            runProfile();

            function runProfile()
            {
                if(currentProfile < config.profiles.length)
                {
                    var profile = config.profiles[currentProfile++];
                    var driver = eval("("+profile.command+")")();

                    var suite = new ts.TestSuite(config.urlPrefix, config.outputPath, profile, config.tests, driver);
                    if(suite)
                    {

                        console.log("Running tests for profile: "+profile.name);
                        suite.runTests(function(profile, results){
                            publisher.publishResults(profile, results);
                            runProfile();
                        });
                    }
                }
                else
                {
                    publisher.publishOverview();
                }
            }
        });

    }
});
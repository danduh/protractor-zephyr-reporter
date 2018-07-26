const popsicle = require('popsicle');
const auth = require('popsicle-basic-auth');
const fs = require('fs');
const jwt = require('atlassian-jwt');
const sha256 = require('js-sha256');

const jwtAuth = (payload, secret) => {
    let authorization = 'JWT ' + jwt.encode(payload, secret, null);

    return function (req, next) {
        req.set('Authorization', authorization);

        return next()
    }

};

const getDate = () => {
    const date = new Date();
    return date.getTime()

    // let response = (date.getDate());
    // response += '/';
    // response += date.toLocaleString('en-us', {month: 'short'});
    // response += '/';
    // response += date.getFullYear().toString().substring(2, 4);
    //
    // return response;
};


const ZephyrService = (options) => {

    const JiraService = require('./jira-service')(options);

    const JWTPayload = {
        qsh: '',
        sub: options.jiraUser,
        iss: options.zapiAccessKey,
        iat: 1532592578,
        exp: 1532996178
    };

    this.createCycle = (name, callback, errorCallback) => {
        const hash = sha256.create();
        hash.update(options.zapiUrl + '/cycle');
        let _t = {
            method: 'POST',
            originalUrl: '/cycle'
        };
        JWTPayload.qsh = jwt.createQueryStringHash(_t, false, options.zapiUrl);
        JWTPayload.qsh = 'dc8e37069edfb14c506ee47e1c4480b52d1058e44e284a2079a305736d249a0b';
        console.log(JWTPayload.qsh);

        let promises = [];
        const _createCycle = (response) => {
            popsicle.request({
                method: 'POST',
                url: options.zapiUrl + '/cycle',
                body: {
                    name,
                    startDate: getDate(),
                    endDate: getDate(),
                    projectId: options.projectId,
                    versionId: response[1] || '-1',
                    sprintId: response[0] || '-1'
                },
                headers: {
                    'Content-Type': 'application/json',
                    'zapiAccessKey': options.zapiAccessKey
                }
            })
                .use([
                    popsicle.plugins.parse('json'),
                    jwtAuth(JWTPayload, options.zapiSecretKey)
                ])
                .then((res) => {
                    callback(res.body.id);
                })
                .catch((error) => {
                    console.log(error.type) //=> "EINVALIDSTATUS"
                    console.log(error.message) //=> "Invalid HTTP status, 404, should be between 200 and 399"
                    console.log(error.status) //=> 404
                    console.log(error.popsicle) //=> Popsicl
                });
        };

        if (options.boardId && options.version) {
            promises = [
                'getActiveSprintId',
                'getVersionId'
            ];
        } else if (options.boardId) {
            promises = [
                'getActiveSprintId'
            ];
        }

        if (promises.length > 0) {
            Promise.all(promises.map((func) => {
                return JiraService[func]();
            }))
                .then((response) => {
                    _createCycle(response);
                });
        } else {
            _createCycle([-1, -1]);
        }

    };

    this.createExecution = (cycleId, issueId, callback, errorCallback) => {
        popsicle.request({
            method: 'POST',
            url: options.zapiUrl + '/execution',
            body: {
                cycleId,
                issueId,
                projectId: options.projectId
            },
            headers: {
                'Content-Type': 'application/json'
            }
        })
            .use([
                popsicle.plugins.parse('json'),
                jwtAuth(JWTPayload, options.zapiSecretKey)
            ])
            .then((res) => {
                callback(Object.keys(res.body)[0]);
            })
            .catch((error) => {
                errorCallback(error);
            });

    };


    this.getStepId = (executionId, stepId, callback, errorCallback) => {
        popsicle.request({
            method: 'GET',
            url: options.zapiUrl + '/stepResult?executionId=' + executionId,
            headers: {
                'Content-Type': 'application/json'
            }
        })
            .use([
                popsicle.plugins.parse('json'),
                jwtAuth(JWTPayload, options.zapiSecretKey)
            ])
            .then(({body = []}) => {
                const index = body.findIndex((step) => String(step.stepId) === stepId);

                if (index === -1) {
                    errorCallback(`spec ${stepId} not found`);
                } else {
                    callback(body[index].id)
                }

            })
            .catch((error) => {
                errorCallback(error);
            });
    };

    this.updateTestStep = (stepId, status, callback, errorCallback) => {
        popsicle.request({
            method: 'PUT',
            url: options.zapiUrl + '/stepResult/' + stepId,
            body: {
                status
            },
            headers: {
                'Content-Type': 'application/json'
            }
        })
            .use([
                popsicle.plugins.parse('json'),
                jwtAuth(JWTPayload, options.zapiSecretKey)
            ])
            .then(() => {
                callback();
            })
            .catch((error) => {
                errorCallback(error);
            });
    };

    this.updateExecution = (executionId, status, callback, errorCallback) => {
        popsicle.request({
            method: 'PUT',
            url: options.zapiUrl + '/execution/' + executionId + '/execute',
            body: {
                status
            },
            headers: {
                'Content-Type': 'application/json'
            }
        })
            .use([
                popsicle.plugins.parse('json'),
                jwtAuth(JWTPayload, options.zapiSecretKey)
            ])
            .then(() => {
                callback();
            })
            .catch((error) => {
                errorCallback(error);
            });
    };

    this.addAttachmentBuffered = (stepId, img, callback, errorCallback) => {
        const entityType = 'STEPRESULT';
        const form = popsicle.form();
        form.append('file', img, {
            filename: stepId + '_screenshot.png'
        });

        popsicle.request({
            method: 'POST',
            url: options.zapiUrl + '/attachment?entityId=' + stepId + '&entityType=' + entityType,
            body: form,
            headers: {
                'X-Atlassian-Token': 'nocheck',
                'Content-Type': 'multipart/form-data',
                'Accept': 'application/json'
            }
        })
            .use(jwtAuth(JWTPayload, options.zapiSecretKey))
            .then(() => {
                callback();
            })
            .catch((error) => {
                errorCallback(error);
            });
    };

    this.addAttachment = (stepId, img, callback, errorCallback) => {
        const entityType = 'STEPRESULT';
        const form = popsicle.form({
            file: fs.createReadStream(img)
        });

        popsicle.request({
            method: 'POST',
            url: options.zapiUrl + '/attachment?entityId=' + stepId + '&entityType=' + entityType,
            body: form,
            headers: {
                'X-Atlassian-Token': 'nocheck',
                'Content-Type': 'multipart/form-data',
                'Accept': 'application/json'
            }
        })
            .use(jwtAuth(JWTPayload, options.zapiSecretKey))
            .then(() => {
                callback();
            })
            .catch((error) => {
                errorCallback(error);
            });
    };

    return this;

};

module.exports = ZephyrService;


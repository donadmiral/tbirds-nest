// Isolated native carousel fixtures use ordinary, unmarked media. Never synthesize a protected grant here.
exports.usePostVideoRepresentation=(uri,edit)=>{
 if(edit?.generatedPosterV1===true)throw Error('Enrolled media requires the real scoped representation fixture');
 return {marked:false,available:true,source:uri,poster:null,original:null};
};
